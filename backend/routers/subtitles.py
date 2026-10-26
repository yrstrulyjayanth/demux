import json
import uuid
import queue
import asyncio
import threading
import subprocess
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from utils.process import process_manager, probe_media_duration
from utils.whisper_utils import (
    SegObj,
    chunk_words,
    process_raw_segments,
    format_timestamp_srt,
    format_timestamp_vtt,
    generate_davinci_timeline_xml,
    generate_davinci_subtitle_xml,
    log_process_error
)

router = APIRouter(prefix="/api", tags=["Subtitles"])

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
LOG_FILE_PATH = ROOT_DIR / "stash_error_log.txt"

class SubtitleGenerationRequest(BaseModel):
    file_path: str
    whisper_model: str = "base"
    language: Optional[str] = None
    resolve_text_type: str = "text_plus"
    gen_srt: bool = True
    gen_vtt: bool = True
    gen_txt: bool = True
    gen_resolve_sub_xml: bool = False
    gen_resolve_timeline_xml: bool = False
    demucs_vocal_clean: bool = True

@router.post("/generate-subtitles")
async def generate_subtitles_stream(req: SubtitleGenerationRequest):
    """
    Feature C: Local OpenAI Whisper Subtitle & DaVinci Resolve XML Generator.
    Supports Demucs vocal audio cleaning, professional phrasal chunking, real-time SSE progress,
    and process tree cancellation.
    """
    clean_path = req.file_path.strip('"').strip("'")
    input_file = Path(clean_path)

    if not input_file.exists():
        raise HTTPException(status_code=400, detail=f"File not found at path: {clean_path}")

    output_dir = ROOT_DIR / "subtitles"
    output_dir.mkdir(parents=True, exist_ok=True)

    base_name = input_file.stem
    srt_file = output_dir / f"{base_name}.srt"
    vtt_file = output_dir / f"{base_name}.vtt"
    txt_file = output_dir / f"{base_name}.txt"
    xml_file = output_dir / f"{base_name}_resolve.xml"
    sub_xml_file = output_dir / f"{base_name}_subtitles_resolve.xml"
    
    unique_tag = uuid.uuid4().hex[:6]
    temp_wav = output_dir / f"{base_name}_temp16k_{unique_tag}.wav"
    clean_vocal_wav = output_dir / f"{base_name}_clean_vocal_{unique_tag}.wav"

    total_duration = probe_media_duration(str(input_file)) or 60.0
    job_id = f"sub_{uuid.uuid4().hex[:8]}"

    async def event_generator():
        yield f"data: {json.dumps({'type': 'start', 'job_id': job_id, 'message': f'Initializing Whisper AI ({req.whisper_model})...'})}\n\n"

        q = queue.Queue()

        def worker():
            try:
                target_audio = input_file

                # Step 1: Optional Demucs Vocal Isolation Pass (Strips background music/trailers/explosions)
                if req.demucs_vocal_clean:
                    q.put({'type': 'progress', 'percent': 5, 'text': 'Isolating vocals with Demucs to eliminate background music...'})
                    cuda_avail = False
                    try:
                        import torch
                        cuda_avail = torch.cuda.is_available()
                    except Exception:
                        pass
                    
                    device_flag = "cuda:0" if cuda_avail else "cpu"
                    demucs_out_dir = output_dir / f"temp_demucs_{unique_tag}"
                    demucs_cmd = [
                        "demucs", "-d", device_flag, "-n", "htdemucs_ft",
                        "--two-stems=vocals", "-o", str(demucs_out_dir.resolve()),
                        str(input_file.resolve())
                    ]
                    demucs_proc = subprocess.Popen(demucs_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    process_manager.register_process(job_id, demucs_proc)
                    demucs_proc.wait()
                    process_manager.unregister_process(job_id)

                    if process_manager.is_cancelled(job_id):
                        q.put({'type': 'cancelled'})
                        return

                    isolated_vocal = demucs_out_dir / "htdemucs_ft" / base_name / "vocals.wav"
                    if isolated_vocal.exists():
                        target_audio = isolated_vocal

                # Step 2: Pre-convert audio stream to 16kHz Mono WAV (Whisper Native Format)
                q.put({'type': 'progress', 'percent': 15, 'text': 'Pre-processing audio for Whisper neural engine...'})
                ffmpeg_prep = [
                    "ffmpeg", "-y", "-i", str(target_audio.resolve()),
                    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                    str(temp_wav.resolve())
                ]
                prep_proc = subprocess.Popen(ffmpeg_prep, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                process_manager.register_process(job_id, prep_proc)
                prep_proc.wait()
                process_manager.unregister_process(job_id)

                if process_manager.is_cancelled(job_id):
                    q.put({'type': 'cancelled'})
                    return

                if prep_proc.returncode == 0 and temp_wav.exists():
                    target_audio = temp_wav

                cuda_avail = False
                try:
                    import torch
                    cuda_avail = torch.cuda.is_available()
                except Exception:
                    pass

                segment_list: List[SegObj] = []
                detected_lang = "en"

                q.put({'type': 'progress', 'percent': 30, 'text': f"Loading Whisper model ({req.whisper_model}) on {'GPU' if cuda_avail else 'CPU'}..."})

                # Try faster-whisper first, then official whisper
                use_faster = False
                try:
                    from faster_whisper import WhisperModel
                    use_faster = True
                except Exception:
                    pass

                if use_faster:
                    model = None
                    if cuda_avail:
                        for c_type in ["float16", "int8_float16", "int8", "float32"]:
                            try:
                                model = WhisperModel(req.whisper_model, device="cuda", compute_type=c_type)
                                break
                            except Exception:
                                pass

                    if model is None:
                        model = WhisperModel(req.whisper_model, device="cpu", compute_type="int8")

                    if process_manager.is_cancelled(job_id):
                        q.put({'type': 'cancelled'})
                        return

                    q.put({'type': 'progress', 'percent': 40, 'text': 'Transcribing audio speech streams...'})
                    lang_arg = req.language if req.language and req.language.strip() and req.language != "auto" else None
                    
                    segments, info = model.transcribe(
                        str(target_audio.resolve()),
                        language=lang_arg,
                        beam_size=5,
                        word_timestamps=True,
                        vad_filter=True,
                        vad_parameters=dict(min_silence_duration_ms=1500, speech_pad_ms=400),
                        condition_on_previous_text=False,
                        compression_ratio_threshold=2.4,
                        log_prob_threshold=-1.0,
                        no_speech_threshold=0.6,
                    )
                    detected_lang = getattr(info, "language", "en")

                    all_words = []
                    raw_segs = []
                    for seg in segments:
                        if process_manager.is_cancelled(job_id):
                            q.put({'type': 'cancelled'})
                            return
                        raw_segs.append(seg)
                        w_list = getattr(seg, "words", None)
                        if w_list:
                            all_words.extend(w_list)
                        
                        seg_end = float(getattr(seg, "end", 0))
                        pct = min(90, max(40, int((seg_end / total_duration) * 100)))
                        q.put({'type': 'progress', 'percent': pct, 'text': f"Transcribing speech ({pct}%)..."})

                    if all_words:
                        segment_list = chunk_words(all_words)
                    if not segment_list:
                        segment_list = process_raw_segments(raw_segs)

                else:
                    import whisper
                    w_device = "cuda" if cuda_avail else "cpu"
                    w_model = whisper.load_model(req.whisper_model, device=w_device)
                    
                    if process_manager.is_cancelled(job_id):
                        q.put({'type': 'cancelled'})
                        return

                    q.put({'type': 'progress', 'percent': 50, 'text': 'Transcribing speech with OpenAI Whisper...'})
                    lang_arg = req.language if req.language and req.language.strip() and req.language != "auto" else None
                    res = w_model.transcribe(
                        str(target_audio.resolve()),
                        language=lang_arg,
                        fp16=False,
                        word_timestamps=True,
                        condition_on_previous_text=False,
                        compression_ratio_threshold=2.4,
                        logprob_threshold=-1.0,
                        no_speech_threshold=0.6,
                    )
                    detected_lang = res.get("language", "en")

                    all_words = []
                    raw_segs = []
                    for seg in res.get("segments", []):
                        raw_segs.append(seg)
                        w_list = seg.get("words")
                        if w_list:
                            all_words.extend(w_list)

                    if all_words:
                        segment_list = chunk_words(all_words)
                    if not segment_list:
                        segment_list = process_raw_segments(raw_segs)

                if process_manager.is_cancelled(job_id):
                    q.put({'type': 'cancelled'})
                    return

                q.put({'type': 'progress', 'percent': 95, 'text': 'Formatting output subtitle and XML files...'})

                srt_lines = []
                vtt_lines = ["WEBVTT\n"]
                txt_lines = []

                for idx, seg in enumerate(segment_list, 1):
                    start_srt = format_timestamp_srt(seg.start)
                    end_srt = format_timestamp_srt(seg.end)
                    start_vtt = format_timestamp_vtt(seg.start)
                    end_vtt = format_timestamp_vtt(seg.end)
                    text = seg.text.strip()

                    srt_lines.append(f"{idx}\n{start_srt} --> {end_srt}\n{text}\n")
                    vtt_lines.append(f"{idx}\n{start_vtt} --> {end_vtt}\n{text}\n")
                    txt_lines.append(f"[{start_srt}] {text}")

                if not srt_lines:
                    srt_lines = ["1\n00:00:00,000 --> 00:00:05,000\n[No speech detected]\n"]
                    vtt_lines.append("1\n00:00:00.000 --> 00:00:05.000\n[No speech detected]\n")
                    txt_lines = ["[00:00:00,000] [No speech detected]"]

                if req.gen_srt:
                    srt_file.write_text("\n".join(srt_lines), encoding="utf-8")
                if req.gen_vtt:
                    vtt_file.write_text("\n".join(vtt_lines), encoding="utf-8")
                if req.gen_txt:
                    txt_file.write_text("\n".join(txt_lines), encoding="utf-8")

                if req.gen_resolve_timeline_xml:
                    xml_content = generate_davinci_timeline_xml(input_file, segment_list, base_name)
                    xml_file.write_text(xml_content, encoding="utf-8")

                if req.gen_resolve_sub_xml:
                    sub_xml_content = generate_davinci_subtitle_xml(segment_list, base_name)
                    sub_xml_file.write_text(sub_xml_content, encoding="utf-8")

                rel_srt = srt_file.relative_to(ROOT_DIR / "subtitles") if (srt_file.exists() and srt_file.is_relative_to(ROOT_DIR / "subtitles")) else None
                rel_vtt = vtt_file.relative_to(ROOT_DIR / "subtitles") if (vtt_file.exists() and vtt_file.is_relative_to(ROOT_DIR / "subtitles")) else None
                rel_txt = txt_file.relative_to(ROOT_DIR / "subtitles") if (txt_file.exists() and txt_file.is_relative_to(ROOT_DIR / "subtitles")) else None
                rel_xml = xml_file.relative_to(ROOT_DIR / "subtitles") if (xml_file.exists() and xml_file.is_relative_to(ROOT_DIR / "subtitles")) else None
                rel_sub_xml = sub_xml_file.relative_to(ROOT_DIR / "subtitles") if (sub_xml_file.exists() and sub_xml_file.is_relative_to(ROOT_DIR / "subtitles")) else None

                q.put({
                    'type': 'complete',
                    'result': {
                        "status": "success",
                        "message": f"Subtitles generated successfully using Whisper ({str(detected_lang).upper()})!",
                        "detected_language": str(detected_lang),
                        "output_directory": str(output_dir.resolve()),
                        "srt_path": str(srt_file.resolve()) if (req.gen_srt and srt_file.exists()) else None,
                        "srt_url": f"/media/subtitles/{rel_srt.as_posix()}" if rel_srt else None,
                        "vtt_path": str(vtt_file.resolve()) if (req.gen_vtt and vtt_file.exists()) else None,
                        "vtt_url": f"/media/subtitles/{rel_vtt.as_posix()}" if rel_vtt else None,
                        "txt_path": str(txt_file.resolve()) if (req.gen_txt and txt_file.exists()) else None,
                        "txt_url": f"/media/subtitles/{rel_txt.as_posix()}" if rel_txt else None,
                        "xml_path": str(xml_file.resolve()) if (req.gen_resolve_timeline_xml and xml_file.exists()) else None,
                        "xml_url": f"/media/subtitles/{rel_xml.as_posix()}" if rel_xml else None,
                        "sub_xml_path": str(sub_xml_file.resolve()) if (req.gen_resolve_sub_xml and sub_xml_file.exists()) else None,
                        "sub_xml_url": f"/media/subtitles/{rel_sub_xml.as_posix()}" if rel_sub_xml else None,
                        "resolve_text_type": req.resolve_text_type,
                        "transcript_summary": "\n".join(txt_lines[:10]) + ("\n..." if len(txt_lines) > 10 else "")
                    }
                })

            except Exception as e:
                import traceback
                tb_str = traceback.format_exc()
                log_process_error(
                    log_file_path=LOG_FILE_PATH,
                    command=f"Whisper Transcribe ({req.whisper_model})",
                    returncode=-1,
                    stdout="",
                    stderr=f"{type(e).__name__}: {str(e)}\n\nFull Traceback:\n{tb_str}",
                    context_info="Feature C: Whisper Subtitles (Python Exception)"
                )
                q.put({'type': 'error', 'message': 'Subtitle generation failed. Check stash_error_log.txt for details.'})
            finally:
                if temp_wav.exists():
                    try:
                        temp_wav.unlink()
                    except Exception:
                        pass
                # Cleanup temp demucs dir if created
                try:
                    demucs_temp_path = output_dir / f"temp_demucs_{unique_tag}"
                    if demucs_temp_path.exists():
                        import shutil
                        shutil.rmtree(demucs_temp_path, ignore_errors=True)
                except Exception:
                    pass

        threading.Thread(target=worker, daemon=True).start()

        done_item = None
        while done_item is None:
            await asyncio.sleep(0.1)
            while not q.empty():
                item = q.get_nowait()
                if item['type'] == 'progress':
                    yield f"data: {json.dumps(item)}\n\n"
                elif item['type'] in ['complete', 'error', 'cancelled']:
                    done_item = item

        if done_item['type'] == 'cancelled':
            err_evt = json.dumps({'type': 'error', 'message': 'Subtitle generation stopped by user.'})
            yield f"data: {err_evt}\n\n"
        elif done_item['type'] == 'error':
            err_evt = json.dumps({'type': 'error', 'message': done_item['message']})
            yield f"data: {err_evt}\n\n"
        elif done_item['type'] == 'complete':
            success_evt = json.dumps({
                'type': 'complete',
                'percent': 100,
                'result': done_item['result']
            })
            yield f"data: {success_evt}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
