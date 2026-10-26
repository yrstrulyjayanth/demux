import re
import json
import uuid
import queue
import asyncio
import threading
import subprocess
from pathlib import Path
from typing import Optional, Dict
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from utils.process import process_manager, probe_media_duration
from utils.whisper_utils import log_process_error

router = APIRouter(prefix="/api", tags=["Audio"])

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
LOG_FILE_PATH = ROOT_DIR / "stash_error_log.txt"

class AudioSeparationRequest(BaseModel):
    file_path: str
    model_name: str = "htdemucs_ft"
    stem_mode: str = "vocals"  # "vocals", "drums", "bass", "all_4_stems"
    output_format: str = "mp3"
    mp3_bitrate: int = 320
    shifts: int = 2
    custom_output_dir: Optional[str] = None

class AudioConversionRequest(BaseModel):
    file_path: str
    target_format: str = "mp3"
    audio_bitrate: str = "320k"
    output_path: Optional[str] = None

@router.post("/separate-audio")
async def separate_audio_stream(req: AudioSeparationRequest):
    """
    Feature A: Audio Separation (Demucs) with real-time SSE progress, GPU acceleration,
    and process tree cancellation support.
    """
    clean_path = req.file_path.strip('"').strip("'")
    input_file = Path(clean_path)

    if not input_file.exists():
        raise HTTPException(status_code=400, detail=f"File not found at path: {clean_path}")

    if req.custom_output_dir and req.custom_output_dir.strip():
        out_base_dir = Path(req.custom_output_dir.strip('"').strip("'"))
    else:
        out_base_dir = ROOT_DIR / "separated"
    
    out_base_dir.mkdir(parents=True, exist_ok=True)

    cuda_avail = False
    try:
        import torch
        cuda_avail = torch.cuda.is_available()
    except Exception:
        pass

    device_flag = "cuda:0" if cuda_avail else "cpu"
    model = req.model_name if req.model_name else "htdemucs_ft"
    
    cmd = ["demucs", "-d", device_flag, "-n", model, "-o", str(out_base_dir.resolve())]

    if req.shifts and req.shifts > 1:
        cmd.extend(["--shifts", str(req.shifts)])

    if req.stem_mode in ["vocals", "drums", "bass"]:
        cmd.extend([f"--two-stems={req.stem_mode}"])
    
    ext = req.output_format.lower()
    if ext == "mp3":
        cmd.extend(["--mp3", "--mp3-bitrate", str(req.mp3_bitrate)])
    elif ext == "flac":
        cmd.extend(["--flac"])

    cmd.append(str(input_file.resolve()))
    cmd_str = " ".join([f'"{arg}"' if " " in arg else arg for arg in cmd])
    job_id = f"sep_{uuid.uuid4().hex[:8]}"

    async def event_generator():
        start_msg = f"Initializing {'NVIDIA GPU' if cuda_avail else 'CPU'} Engine ({model})..."
        yield f"data: {json.dumps({'type': 'start', 'job_id': job_id, 'message': start_msg, 'command': cmd_str})}\n\n"
        
        q = queue.Queue()
        
        def worker():
            proc = subprocess.Popen(
                cmd,
                cwd=str(ROOT_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace"
            )
            process_manager.register_process(job_id, proc)

            percent_pattern = re.compile(r'(\d+)%')
            stderr_buf = []
            
            while True:
                line = proc.stderr.readline()
                if not line:
                    break
                stderr_buf.append(line)
                matches = percent_pattern.findall(line)
                if matches:
                    try:
                        pct = int(matches[-1])
                        if pct < 20:
                            clean_status = f"Loading neural model ({pct}%)..."
                        elif pct < 90:
                            clean_status = f"Isolating stems with {'GPU' if cuda_avail else 'CPU'} acceleration ({pct}%)..."
                        else:
                            clean_status = f"Writing output files ({pct}%)..."

                        q.put({'type': 'progress', 'percent': pct, 'text': clean_status})
                    except ValueError:
                        pass
            
            proc.wait()
            process_manager.unregister_process(job_id)
            q.put({'type': 'done', 'returncode': proc.returncode, 'stderr': "".join(stderr_buf)})

        threading.Thread(target=worker, daemon=True).start()

        done_item = None
        while done_item is None:
            await asyncio.sleep(0.1)
            while not q.empty():
                item = q.get_nowait()
                if item['type'] == 'progress':
                    yield f"data: {json.dumps(item)}\n\n"
                elif item['type'] == 'done':
                    done_item = item

        if done_item['returncode'] != 0 or process_manager.is_cancelled(job_id):
            if not process_manager.is_cancelled(job_id):
                log_process_error(
                    log_file_path=LOG_FILE_PATH,
                    command=cmd_str,
                    returncode=done_item['returncode'],
                    stdout="",
                    stderr=done_item['stderr'],
                    context_info=f"Feature A: Audio Separation ({model}, {req.stem_mode}, {req.output_format})"
                )
            err_evt = json.dumps({
                'type': 'error',
                'message': 'Process stopped by user or interrupted.'
            })
            yield f"data: {err_evt}\n\n"
            return

        stem_folder = input_file.stem
        output_dir = out_base_dir / model / stem_folder
        if not output_dir.exists():
            output_dir = out_base_dir / "htdemucs" / stem_folder

        file_ext = ext if ext in ["mp3", "flac"] else "wav"
        
        found_stems = {}
        if output_dir.exists():
            for f in output_dir.glob(f"*.{file_ext}"):
                rel_path = f.relative_to(ROOT_DIR / "separated") if f.is_relative_to(ROOT_DIR / "separated") else None
                web_url = f"/media/separated/{rel_path.as_posix()}" if rel_path else None
                found_stems[f.stem] = {
                    "abs_path": str(f.resolve()),
                    "web_url": web_url
                }

        # Fix bug #6: Handle all_4_stems mode gracefully vs two-stem mode
        if req.stem_mode == "all_4_stems":
            target_stem = "vocals"
            primary_file = output_dir / f"vocals.{file_ext}"
            no_target_file = output_dir / f"other.{file_ext}"
        else:
            target_stem = req.stem_mode
            primary_file = output_dir / f"{target_stem}.{file_ext}"
            no_target_file = output_dir / f"no_{target_stem}.{file_ext}"

        primary_web_url = found_stems.get(target_stem, {}).get("web_url")
        background_key = "other" if req.stem_mode == "all_4_stems" else f"no_{target_stem}"
        no_target_web_url = found_stems.get(background_key, {}).get("web_url")

        success_evt = json.dumps({
            'type': 'complete',
            'percent': 100,
            'result': {
                "status": "success",
                "message": f"Audio separated using {model} ({ext.upper()}) successfully!",
                "command_executed": cmd_str,
                "model_used": model,
                "output_directory": str(output_dir.resolve()) if output_dir.exists() else str(out_base_dir.resolve()),
                "format": file_ext,
                "stems": found_stems,
                "primary_stem_path": str(primary_file.resolve()) if primary_file.exists() else None,
                "primary_stem_url": primary_web_url,
                "background_stem_path": str(no_target_file.resolve()) if no_target_file.exists() else None,
                "background_stem_url": no_target_web_url
            }
        })
        yield f"data: {success_evt}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/convert-audio")
async def convert_audio_stream(req: AudioConversionRequest):
    """
    Universal Audio Converter: Streamed SSE endpoint with real FFmpeg progress calculation,
    non-blocking execution, and process cancellation support (fixes bugs #3 and #13).
    """
    clean_path = req.file_path.strip('"').strip("'")
    input_file = Path(clean_path)

    if not input_file.exists():
        raise HTTPException(status_code=400, detail=f"File not found at path: {clean_path}")

    target_ext = req.target_format.lower().lstrip(".")
    if req.output_path and req.output_path.strip():
        output_file = Path(req.output_path.strip('"').strip("'"))
    else:
        output_dir = ROOT_DIR / "converted_audio"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / f"{input_file.stem}_converted.{target_ext}"

    output_file.parent.mkdir(parents=True, exist_ok=True)

    cmd = ["ffmpeg", "-y", "-i", str(input_file.resolve())]

    if target_ext == "mp3":
        cmd.extend(["-c:a", "libmp3lame", "-b:a", req.audio_bitrate])
    elif target_ext == "wav":
        cmd.extend(["-c:a", "pcm_s16le"])
    elif target_ext == "flac":
        cmd.extend(["-c:a", "flac"])
    elif target_ext in ["aac", "m4a"]:
        cmd.extend(["-c:a", "aac", "-b:a", req.audio_bitrate])
    elif target_ext == "ogg":
        cmd.extend(["-c:a", "libvorbis", "-q:a", "6"])
    elif target_ext == "aiff":
        cmd.extend(["-c:a", "pcm_s16be"])

    cmd.append(str(output_file.resolve()))
    cmd_str = " ".join([f'"{arg}"' if " " in arg else arg for arg in cmd])

    total_duration = probe_media_duration(str(input_file))
    job_id = f"audioconv_{uuid.uuid4().hex[:8]}"

    async def event_generator():
        yield f"data: {json.dumps({'type': 'start', 'job_id': job_id, 'message': f'Converting audio to .{target_ext.upper()}...', 'command': cmd_str})}\n\n"

        time_pattern = re.compile(r'time=(\d+):(\d+):(\d+.\d+)')
        q = queue.Queue()

        def worker():
            proc = subprocess.Popen(
                cmd,
                cwd=str(ROOT_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace"
            )
            process_manager.register_process(job_id, proc)

            stderr_buf = []
            while True:
                line = proc.stderr.readline()
                if not line:
                    break
                stderr_buf.append(line)
                time_match = time_pattern.search(line)
                if time_match:
                    h, m, s = map(float, time_match.groups())
                    curr_seconds = h * 3600 + m * 60 + s
                    if total_duration and total_duration > 0:
                        pct = min(98, max(5, int((curr_seconds / total_duration) * 100)))
                    else:
                        pct = 50
                    q.put({
                        'type': 'progress',
                        'percent': pct,
                        'text': f"Converting audio to .{target_ext.upper()} ({pct}%)..."
                    })

            proc.wait()
            process_manager.unregister_process(job_id)
            q.put({'type': 'done', 'returncode': proc.returncode, 'stderr': "".join(stderr_buf)})

        threading.Thread(target=worker, daemon=True).start()

        done_item = None
        while done_item is None:
            await asyncio.sleep(0.1)
            while not q.empty():
                item = q.get_nowait()
                if item['type'] == 'progress':
                    yield f"data: {json.dumps(item)}\n\n"
                elif item['type'] == 'done':
                    done_item = item

        if done_item['returncode'] != 0 or process_manager.is_cancelled(job_id):
            if not process_manager.is_cancelled(job_id):
                log_process_error(
                    log_file_path=LOG_FILE_PATH,
                    command=cmd_str,
                    returncode=done_item['returncode'],
                    stdout="",
                    stderr=done_item['stderr'],
                    context_info=f"Audio Converter ({target_ext.upper()})"
                )
            err_evt = json.dumps({
                'type': 'error',
                'message': 'Audio conversion cancelled or interrupted.'
            })
            yield f"data: {err_evt}\n\n"
            return

        rel_path = output_file.relative_to(ROOT_DIR / "converted_audio") if output_file.is_relative_to(ROOT_DIR / "converted_audio") else None
        web_url = f"/media/converted_audio/{rel_path.as_posix()}" if rel_path else None

        success_evt = json.dumps({
            'type': 'complete',
            'percent': 100,
            'result': {
                "status": "success",
                "message": f"Audio converted to .{target_ext.upper()} successfully!",
                "command_executed": cmd_str,
                "output_file": str(output_file.resolve()),
                "web_url": web_url
            }
        })
        yield f"data: {success_evt}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
