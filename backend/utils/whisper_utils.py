import re
import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import List, Any, Optional

# Maximum subtitle chunk duration in seconds before forcing a break
MAX_CHUNK_DURATION = 6.5
# Hard ceiling: even if breaking would orphan 1-2 words, never let a chunk exceed this
HARD_MAX_CHUNK_DURATION = 7.5

@dataclass
class SegObj:
    start: float
    end: float
    text: str

def format_timestamp_srt(seconds: float) -> str:
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds % 1) * 1000))
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"

def format_timestamp_vtt(seconds: float) -> str:
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds % 1) * 1000))
    return f"{hrs:02d}:{mins:02d}:{secs:02d}.{millis:03d}"

def _w_get(w: Any, key: str) -> Any:
    if isinstance(w, dict):
        return w.get(key)
    return getattr(w, key, None)

def _normalize_text(text: str) -> str:
    """Lowercase, collapse whitespace, strip trailing punctuation for comparison."""
    t = re.sub(r'\s+', ' ', text).strip().lower()
    # strip trailing punctuation (but keep internal apostrophes like "don't")
    t = re.sub(r'[.,!?;:—–…"\']+$', '', t).strip()
    return t

def collapse_internal_repeats(text: str) -> str:
    """
    Collapse immediately repeated phrases/words within a single subtitle.
    Handles common Whisper artifacts like "X. X. X." or "X X X".
    Examples:
        "Who the hell are you guys? Who the hell are you guys?" → "Who the hell are you guys?"
        "Run from it. Run from it." → "Run from it."
        "Dread it. Dread it." → "Dread it."
    """
    t = text.strip()
    if not t:
        return t

    # Split into sentence-like blocks by terminal punctuation followed by space+capital
    blocks = re.split(r'(?<=[.!?])\s+', t)
    if len(blocks) <= 1:
        # No sentence splits — try splitting by repeated word sequences (space-separated)
        words = t.split()
        if len(words) >= 4:
            mid = len(words) // 2
            first_half = " ".join(words[:mid]).lower().rstrip('.,!?;:')
            second_half = " ".join(words[mid:]).lower().rstrip('.,!?;:')
            if first_half == second_half:
                return " ".join(words[:mid])
        return t

    # Check if all blocks are identical (normalized)
    norm_blocks = [_normalize_text(b) for b in blocks]
    if len(set(norm_blocks)) == 1 and len(blocks) >= 2:
        return blocks[0]

    # Check for repeated pairs (e.g., "A. A. B." → still A. A. B — no collapse)
    # But "A. A. A." → A. (handled above)

    # Handle case where blocks alternate between two phrases that are repeats
    # e.g., blocks = ["A", "A", "B"] — not all same, skip
    return t

# Max gap (seconds) between consecutive near-duplicate subtitles still treated as
# a Whisper loop artifact. A human-spoken line repeated for real is separated by
# other dialogue or > 3s of distinct content, so it survives this pass.
DEDUP_GAP_THRESHOLD = 3.0

def dedupe_segments(segs: List['SegObj']) -> List['SegObj']:
    """
    Remove consecutive near-duplicate segments caused by Whisper word-timestamp
    repetition artifacts. Preserves legitimate repeats spoken at distant timestamps.
    """
    if not segs:
        return []

    out: List['SegObj'] = []
    for seg in segs:
        if out:
            prev = out[-1]
            norm_prev = _normalize_text(prev.text)
            norm_new = _normalize_text(seg.text)
            gap = seg.start - prev.end
            is_close = gap <= DEDUP_GAP_THRESHOLD or (seg.start < prev.end + 0.05)  # close in time or overlapping

            if norm_prev == norm_new and is_close:
                # Exact duplicate in close proximity — drop the newer one
                continue
            if norm_new in norm_prev and is_close and len(norm_prev) > len(norm_new):
                # Substring of previous, overlapping — previous is more complete, drop
                continue
            if norm_prev in norm_new and is_close and len(norm_new) > len(norm_prev):
                # Current is longer/expanded duplicate of previous — replace prev
                out[-1] = SegObj(start=prev.start, end=seg.end, text=seg.text)
                continue
        out.append(seg)
    return out

def chunk_words(words_list: List[Any], max_words: int = 9, max_chars: int = 42, max_gap_sec: float = 0.3) -> List[SegObj]:
    """
    Professional Phrasal Subtitle Engine:
    - Groups words naturally by grammatical clauses, sentence endings, and vocal pauses.
    - Prevents awkward mid-phrase breaks (e.g. trailing prepositions like 'to', 'of', 'in').
    - Merges micro-fragments (< 3 words or < 1.0s duration) to eliminate 0.2s single-word blips.
    - Clamps display durations for smooth readability.
    """
    punct_end_re = re.compile(r'[.!?;\u2014\u2013\u2026]$')
    punct_clause_re = re.compile(r'[,:]$')
    prepositions = {"to", "of", "in", "on", "at", "for", "with", "by", "from", "and", "or", "but", "the", "a", "an"}

    valid_words = []
    for w in words_list:
        st = _w_get(w, "start")
        et = _w_get(w, "end")
        wt = _w_get(w, "word")
        if st is not None and et is not None and wt is not None:
            try:
                valid_words.append((float(st), float(et), str(wt)))
            except (ValueError, TypeError):
                pass

    if not valid_words:
        return []

    chunks = []
    curr = []

    total_words = len(valid_words)
    for idx, item in enumerate(valid_words):
        w_start, w_end, w_text = item

        should_break = False
        if curr:
            prev_end = curr[-1][1]
            prev_text = curr[-1][2].strip()
            curr_text_len = sum(len(x[2]) for x in curr)
            curr_dur = w_end - curr[0][0]

            # Rule 1: Break on significant vocal pause
            if (w_start - prev_end) > max_gap_sec:
                should_break = True
            # Rule 2: Break on sentence ending punctuation (. ? ! ; —)
            elif punct_end_re.search(prev_text):
                should_break = True
            # Rule 3: Break on clause punctuation (, :) if chunk has at least 4 words
            elif punct_clause_re.search(prev_text) and len(curr) >= 4:
                should_break = True
            # Rule 4: Break if max character count or max word count reached, UNLESS previous word is a trailing preposition
            elif (len(curr) >= max_words or curr_text_len >= max_chars):
                clean_prev = prev_text.lower().strip(".,!?;:\"'")
                if clean_prev not in prepositions or len(curr) >= (max_words + 3):
                    should_break = True
            # Rule 5: Break on duration cap (prevents 7+ second walls of text).
            # If the break would orphan fewer than 3 words, ride to the next natural
            # boundary instead — unless the hard ceiling is hit.
            elif curr_dur >= MAX_CHUNK_DURATION:
                remaining = total_words - idx
                if remaining >= 3 or curr_dur >= HARD_MAX_CHUNK_DURATION:
                    should_break = True

        if should_break:
            chunks.append(curr)
            curr = []

        curr.append(item)

    if curr:
        chunks.append(curr)

    raw_segs: List[SegObj] = []
    for c in chunks:
        if not c:
            continue
        c_start = c[0][0]
        c_end = c[-1][1]
        c_text = " ".join([x[2].strip() for x in c if x[2].strip()]).strip()
        if not c_text:
            continue
        raw_segs.append(SegObj(start=c_start, end=c_end, text=c_text))

    return post_process_segments(raw_segs)

def process_raw_segments(raw_segments: List[Any], max_words_per_seg: int = 8) -> List[SegObj]:
    segs: List[SegObj] = []
    for seg in raw_segments:
        s_start = float(_w_get(seg, "start") or 0.0)
        s_end = float(_w_get(seg, "end") or 0.0)
        s_text = str(_w_get(seg, "text") or "").strip()
        if not s_text:
            continue

        words = s_text.split()
        if len(words) > max_words_per_seg:
            num_chunks = (len(words) + max_words_per_seg - 1) // max_words_per_seg
            dur_per_chunk = (s_end - s_start) / num_chunks
            for k in range(num_chunks):
                chunk_words_list = words[k*max_words_per_seg : (k+1)*max_words_per_seg]
                cs = s_start + k * dur_per_chunk
                ce = cs + dur_per_chunk - 0.05
                segs.append(SegObj(start=cs, end=ce, text=" ".join(chunk_words_list)))
        else:
            segs.append(SegObj(start=s_start, end=s_end, text=s_text))

    return post_process_segments(segs)

def post_process_segments(segs: List[SegObj]) -> List[SegObj]:
    """
    Pass 2: Collapses Whisper repeat artifacts, dedupes cross-segment duplicates,
    merges orphaned micro-segments (< 3 words or < 1.0s), and smooths subtitle timings.
    """
    if not segs:
        return []

    # Pass 0: Collapse within-segment repeats ("X X X" → "X")
    for seg in segs:
        collapsed = collapse_internal_repeats(seg.text)
        if collapsed != seg.text:
            seg.text = collapsed

    # Pass 0.5: Drop cross-segment near-duplicates (Whisper loop-conditioning artifacts)
    segs = dedupe_segments(segs)
    if not segs:
        return []

    # Step A: Merge short orphaned fragments (< 3 words OR < 1.0s duration) with neighboring segments
    merged: List[SegObj] = []
    for seg in segs:
        word_count = len(seg.text.split())
        duration = seg.end - seg.start

        if merged:
            prev = merged[-1]
            prev_words = len(prev.text.split())
            gap_to_prev = seg.start - prev.end

            # Merge into previous segment if current segment is tiny OR previous segment was tiny
            if (word_count < 3 or duration < 1.0) and gap_to_prev < 2.0 and (prev_words + word_count) <= 10:
                prev.end = max(prev.end, seg.end)
                prev.text = f"{prev.text} {seg.text}".strip()
                continue
            elif (prev_words < 3 or (prev.end - prev.start) < 1.0) and gap_to_prev < 2.0 and (prev_words + word_count) <= 10:
                prev.end = max(prev.end, seg.end)
                prev.text = f"{prev.text} {seg.text}".strip()
                continue

        merged.append(SegObj(start=seg.start, end=seg.end, text=seg.text))

    # Step B: Smooth timing gaps & ensure minimum reading display duration (1.2s minimum)
    for i in range(len(merged)):
        # Ensure minimum display duration based on length
        min_duration = max(1.2, min(3.5, len(merged[i].text.split()) * 0.35))
        if merged[i].end - merged[i].start < min_duration:
            merged[i].end = merged[i].start + min_duration

        if i < len(merged) - 1:
            next_start = merged[i+1].start
            # If gap to next subtitle is less than 1.0s, bridge the gap so subtitle doesn't flicker off
            if 0 <= next_start - merged[i].end < 1.0:
                merged[i].end = next_start
            elif merged[i].end > next_start:
                merged[i].end = max(merged[i].start + 0.5, next_start - 0.05)

    return merged

def generate_davinci_timeline_xml(input_file: Path, segment_list: List[SegObj], base_name: str) -> str:
    duration_sec = segment_list[-1].end if len(segment_list) > 0 else 10.0
    total_frames = int(duration_sec * 30)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
    <resources>
        <format id="r1" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080"/>
        <asset id="a1" name="{input_file.name}" src="file:///{input_file.resolve().as_posix()}" duration="{total_frames}/30s" hasVideo="1" hasAudio="1"/>
    </resources>
    <library>
        <event name="{base_name}">
            <project name="{base_name}_Resolve_Timeline">
                <sequence duration="{total_frames}/30s" format="r1">
                    <spine>
                        <asset-clip ref="a1" offset="0s" duration="{total_frames}/30s" name="{input_file.name}"/>
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>
'''

def generate_davinci_subtitle_xml(segment_list: List[SegObj], base_name: str) -> str:
    duration_sec = segment_list[-1].end if len(segment_list) > 0 else 10.0
    total_frames = int(duration_sec * 30)
    effect_name = "Basic Title"
    effect_uid = ".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.localized"

    sub_resources = f'''    <resources>
        <format id="r1" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080"/>
        <effect id="e1" name="{effect_name}" uid="{effect_uid}"/>
    </resources>'''

    title_clips = []
    for idx, seg in enumerate(segment_list):
        seg_start_frames = int(round(seg.start * 30))
        seg_end_frames = int(round(seg.end * 30))
        seg_dur_frames = max(seg_end_frames - seg_start_frames, 1)
        text_escaped = seg.text.strip().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
        title_clips.append(
            f'                        <title ref="e1" lane="1" offset="{seg_start_frames}/30s" '
            f'duration="{seg_dur_frames}/30s" name="Subtitle {idx+1}">\n'
            f'                            <text>\n'
            f'                                <text-style ref="ts1">{text_escaped}</text-style>\n'
            f'                            </text>\n'
            f'                            <text-style-def id="ts1">\n'
            f'                                <text-style font="Arial" fontSize="42" fontColor="1 1 1 1" bold="1" alignment="center"/>\n'
            f'                            </text-style-def>\n'
            f'                        </title>'
        )

    titles_xml = "\n".join(title_clips)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
{sub_resources}
    <library>
        <event name="{base_name}_Subtitles">
            <project name="{base_name}_Subtitles_Timeline">
                <sequence duration="{total_frames}/30s" format="r1">
                    <spine>
                        <gap offset="0s" duration="{total_frames}/30s" name="Gap">
{titles_xml}
                        </gap>
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>
'''

def log_process_error(log_file_path: Path, command: str, returncode: int, stdout: str, stderr: str, context_info: str = ""):
    """Appends raw process failure details to log file."""
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = (
        f"\n==================================================\n"
        f"TIMESTAMP: {timestamp}\n"
        f"CONTEXT: {context_info}\n"
        f"COMMAND: {command}\n"
        f"EXIT CODE: {returncode}\n"
        f"---------------- STDOUT ----------------\n"
        f"{stdout.strip() if stdout else '[No stdout output]'}\n"
        f"---------------- STDERR ----------------\n"
        f"{stderr.strip() if stderr else '[No stderr output]'}\n"
        f"==================================================\n"
    )
    try:
        with open(log_file_path, "a", encoding="utf-8") as f:
            f.write(log_entry)
            f.flush()
    except Exception as e:
        print(f"Error writing to log file: {e}")
