"""Unit tests for Whisper subtitle-quality fixes.

Covers: collapse_internal_repeats, dedupe_segments, chunk_words duration cap,
and the post_process_segments pass order (repeat artifact removal).

Run from repo root:  python test_subtitle_quality.py
"""
import sys
from dataclasses import dataclass

sys.path.insert(0, ".")

from backend.utils.whisper_utils import (
    SegObj,
    chunk_words,
    collapse_internal_repeats,
    dedupe_segments,
    MAX_CHUNK_DURATION,
    HARD_MAX_CHUNK_DURATION,
)

PASS = 0
FAIL = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}")


# ---------------------------------------------------------------------------
# 1. collapse_internal_repeats
# ---------------------------------------------------------------------------
print("\n== collapse_internal_repeats ==")
check(
    "single sentence repeat collapses",
    collapse_internal_repeats("Who the hell are you guys? Who the hell are you guys?")
    == "Who the hell are you guys?",
)
check(
    "triple sentence repeat collapses to one",
    collapse_internal_repeats("Dread it. Dread it. Dread it.") == "Dread it.",
)
check(
    "punctuation-only repeat collapses",
    collapse_internal_repeats("Run from it. Run from it.") == "Run from it.",
)
check(
    "non-repeat sentence left alone",
    collapse_internal_repeats("In time you will know what it's like to lose.")
    == "In time you will know what it's like to lose.",
)
check(
    "word-sequence repeat collapses (no punctuation)",
    collapse_internal_repeats("run from it run from it") == "run from it",
)
check(
    "distinct sentences preserved",
    collapse_internal_repeats("Who the hell are you guys? Run from it.") == "Who the hell are you guys? Run from it.",
)

# ---------------------------------------------------------------------------
# 2. dedupe_segments
# ---------------------------------------------------------------------------
print("\n== dedupe_segments ==")
close_dups = [
    SegObj(0.0, 1.0, "Who the hell are you guys?"),
    SegObj(1.1, 2.0, "Who the hell are you guys?"),  # gap 0.1s < 3.0 -> drop
]
res = dedupe_segments(close_dups)
check("identical text + gap < 3s -> deduplicated", len(res) == 1)

distant_dups = [
    SegObj(0.0, 1.0, "Who the hell are you guys?"),
    SegObj(10.0, 11.0, "Who the hell are you guys?"),  # gap 9s -> legitimate repeat
]
res = dedupe_segments(distant_dups)
check("identical text + gap >= 3s -> both kept", len(res) == 2)

exact_dup = [
    SegObj(0.0, 2.0, "To feel so desperately that you're right."),
    SegObj(1.5, 3.0, "To feel so desperately that you're right."),  # identical, overlapping
]
res = dedupe_segments(exact_dup)
check("identical overlapping text -> dropped, span kept", len(res) == 1 and res[0].end == 2.0)

expanded_dup = [
    SegObj(0.0, 1.0, "To feel so desperately that you're."),
    SegObj(1.2, 3.0, "To feel so desperately that you're right."),  # longer version of prev
]
res = dedupe_segments(expanded_dup)
check("substring of previous -> replace with longer span", len(res) == 1 and res[0].end == 3.0)

# ---------------------------------------------------------------------------
# 3. chunk_words on a Whisper repeat-artifact sequence
# ---------------------------------------------------------------------------
print("\n== chunk_words repeat artifact ==")


@dataclass
class MockWord:
    start: float
    end: float
    word: str


# Simulates Whisper looping "Who the hell are you guys?" three times (~3s total)
loop_words = []
t = 0.0
for _ in range(3):
    for w in ["Who", "the", "hell", "are", "you", "guys?"]:
        loop_words.append(MockWord(t, t + 0.5, w))
        t += 0.5

segs = chunk_words(loop_words)
joined = " ".join(s.text for s in segs).lower()
check("no chunk is a wall (> 6.5s + slack)", all((s.end - s.start) <= MAX_CHUNK_DURATION + 0.6 for s in segs))
check("no chunk exceeds 15 words", all(len(s.text.split()) <= 15 for s in segs))
check("repeated phrase appears at most once", joined.count("who the hell are you guys") <= 1)

# ---------------------------------------------------------------------------
# 4. chunk_words duration cap (Rule 5) with relaxed word cap
# ---------------------------------------------------------------------------
print("\n== chunk_words duration cap ==")
long_words = [MockWord(i * 0.5, i * 0.5 + 0.45, f"w{i}") for i in range(16)]  # 8s of speech
segs = chunk_words(long_words, max_words=30, max_chars=500)
durs = [(s.end - s.start, len(s.text.split())) for s in segs]
check("long run is split into multiple chunks", len(segs) >= 2)
check("no chunk exceeds hard ceiling (7.5s)", all(d <= HARD_MAX_CHUNK_DURATION + 0.1 for d, _ in durs))
check("all words accounted for", sum(c for _, c in durs) == 16)

# ---------------------------------------------------------------------------
# 5. post_process_segments pass order end-to-end
# ---------------------------------------------------------------------------
print("\n== post_process_segments integration ==")
from backend.utils.whisper_utils import post_process_segments

# Notes.txt case: identical sentence chunked twice back-to-back by whisper loop
artifact = [
    SegObj(0.0, 1.0, "In time you will know what it's like to lose."),
    SegObj(1.2, 2.0, "To feel so desperately that you're right."),
    SegObj(2.2, 3.0, "In time you will know what it's like to lose."),
]
res = post_process_segments(artifact)
texts = [s.text for s in res]
check("loop-conditioned repeat is dropped", "In time you will know what it's like to lose." in texts)
check("genuine distinct lines preserved", "To feel so desperately that you're right." in texts)

# Notes.txt case: 9-word chunk + 2-word tail should NOT merge into an 11-word wall.
# (cap-10 merge rule: 9 + 2 = 11 > 10 -> tail stays its own short subtitle)
wall = [
    SegObj(3.0, 6.5, "There was an idea to bring together a group"),
    SegObj(6.8, 8.0, "of remarkable people"),
]
res = post_process_segments(wall)
check("9+2-word merge blocked (no 11-word wall)", len(res) == 2)
check("no chunk exceeds 10 words", all(len(s.text.split()) <= 10 for s in res))

print(f"\n{'-' * 40}\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
