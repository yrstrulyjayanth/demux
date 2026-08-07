import os
import sys
import re
import subprocess
import datetime
import json
import asyncio
import threading
import queue
from pathlib import Path
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Check PyTorch CUDA capability
try:
    import torch
    HAS_CUDA = torch.cuda.is_available()
    CUDA_DEVICE_NAME = torch.cuda.get_device_name(0) if HAS_CUDA else None
except Exception:
    HAS_CUDA = False
    CUDA_DEVICE_NAME = None

# Check faster-whisper capability
try:
    from faster_whisper import WhisperModel
    HAS_WHISPER = True
except Exception:
    HAS_WHISPER = False

# Set Windows Proactor Event Loop Policy for subprocess compatibility
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception as e:
        print(f"Event loop policy warning: {e}")

app = FastAPI(title="Demuxer AI Media Engine API", version="4.0.0")

# Enable CORS for frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Root directory of the project
ROOT_DIR = Path(__file__).resolve().parent.parent
LOG_FILE_PATH = ROOT_DIR / "stash_error_log.txt"

# Mount ROOT_DIR as static route so frontend can play/stream output media
app.mount("/media", StaticFiles(directory=str(ROOT_DIR)), name="media")

# Track active running subprocess for one-click termination
current_active_process: Optional[subprocess.Popen] = None

def register_active_process(proc: subprocess.Popen):
    global current_active_process
    current_active_process = proc

def clear_active_process():
    global current_active_process
    current_active_process = None

def log_process_error(command: str, returncode: int, stdout: str, stderr: str, context_info: str = ""):
    """Appends raw process failure details to stash_error_log.txt in the root directory."""
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
        with open(LOG_FILE_PATH, "a", encoding="utf-8") as f:
            f.write(log_entry)
            f.flush()
    except Exception as e:
        print(f"Error writing to stash_error_log.txt: {e}")

class AudioSeparationRequest(BaseModel):
    file_path: str
    model_name: str = "htdemucs_ft"  # "htdemucs_ft" (Best), "htdemucs" (Fast), "htdemucs_6s", "mdx_extra"
    stem_mode: str = "vocals"  # "vocals", "drums", "bass", "all_4_stems"
    output_format: str = "mp3"  # "mp3", "wav", "flac"
    mp3_bitrate: int = 320
    shifts: int = 2  # Quality boost shift iterations (1 to 5)
    custom_output_dir: Optional[str] = None

class VideoConversionRequest(BaseModel):
    file_path: str
    container: str = "mp4"  # "mp4", "mov", "mkv"
    cq_quality: int = 18
    audio_codec: str = "aac"  # "aac", "pcm"
    output_path: Optional[str] = None

class AudioConversionRequest(BaseModel):
    file_path: str
    target_format: str = "mp3"  # "mp3", "wav", "flac", "aac", "ogg", "m4a", "alac", "aiff"
    audio_bitrate: str = "320k"
    output_path: Optional[str] = None

class SubtitleGenerationRequest(BaseModel):
    file_path: str
    whisper_model: str = "base"  # "tiny", "base", "small", "medium"
    language: Optional[str] = None

class FileInfoRequest(BaseModel):
    file_path: str

class OpenFolderRequest(BaseModel):
    folder_path: str

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

@app.get("/api/health")
def check_health(response: Response):
    """Returns engine health and environment checks."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    ffmpeg_installed = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode == 0
    demucs_installed = subprocess.run(["demucs", "--help"], stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode == 0
    
    cuda_avail = False
    device_name = None
    try:
        import torch
        cuda_avail = torch.cuda.is_available()
        device_name = torch.cuda.get_device_name(0) if cuda_avail else None
    except Exception:
        pass

    has_errors = False
    if LOG_FILE_PATH.exists():
        content = LOG_FILE_PATH.read_text(encoding="utf-8", errors="ignore")
        if "TIMESTAMP:" in content or "EXIT CODE:" in content:
            has_errors = True

    return {
        "status": "online",
        "root_dir": str(ROOT_DIR),
        "log_file": str(LOG_FILE_PATH),
        "ffmpeg": ffmpeg_installed,
        "demucs": demucs_installed,
        "whisper": HAS_WHISPER,
        "cuda_available": cuda_avail,
        "gpu_device": device_name,
        "has_unread_errors": has_errors,
        "is_busy": current_active_process is not None and current_active_process.poll() is None
    }

@app.post("/api/stop-process")
def stop_current_process():
    """Instantly kills any running Demucs or FFmpeg CLI subprocess."""
    global current_active_process
    if current_active_process and current_active_process.poll() is None:
        try:
            current_active_process.kill()
            current_active_process = None
            return {"status": "success", "message": "Process terminated successfully by user."}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    return {"status": "none", "message": "No active process running."}

@app.post("/api/file-info")
def get_file_info(req: FileInfoRequest):
    """Check if file exists and get metadata."""
    p = Path(req.file_path.strip('"').strip("'"))
    if not p.exists():
        return {"exists": False, "error": f"File non-existent: {req.file_path}"}
    
    size_mb = round(p.stat().st_size / (1024 * 1024), 2)
    return {
        "exists": True,
        "filename": p.name,
        "stem": p.stem,
        "path": str(p.resolve()),
        "size_mb": size_mb,
        "extension": p.suffix.lower()
    }

@app.post("/api/generate-subtitles")
def generate_subtitles(req: SubtitleGenerationRequest):
    """
    Feature C: Local OpenAI Whisper Subtitle & DaVinci Resolve XML Generator.
    Generates .srt, .vtt, .txt, and DaVinci Resolve .xml files for 100% free!
    """
    if not HAS_WHISPER:
        raise HTTPException(status_code=500, detail="faster-whisper is not installed in the backend environment.")

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

    try:
        cuda_avail = False
        try:
            import torch
            cuda_avail = torch.cuda.is_available()
        except Exception:
            pass

        model = None
        if cuda_avail:
            for c_type in ["default", "float32", "int8_float16", "int8"]:
                try:
                    model = WhisperModel(req.whisper_model, device="cuda", compute_type=c_type)
                    break
                except Exception:
                    pass

        if model is None:
            model = WhisperModel(req.whisper_model, device="cpu", compute_type="int8")

        lang_arg = req.language if req.language and req.language.strip() and req.language != "auto" else None
        segments, info = model.transcribe(str(input_file.resolve()), language=lang_arg, beam_size=5)

        segment_list = list(segments)

        # Write .srt
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

        srt_file.write_text("\n".join(srt_lines), encoding="utf-8")
        vtt_file.write_text("\n".join(vtt_lines), encoding="utf-8")
        txt_file.write_text("\n".join(txt_lines), encoding="utf-8")

        # Generate DaVinci Resolve FCPXML / XML Timeline
        duration_sec = segment_list[-1].end if len(segment_list) > 0 else 10.0
        xml_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
    <resources>
        <format id="r1" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080"/>
        <asset id="a1" name="{input_file.name}" src="file:///{input_file.resolve().as_posix()}" duration="{int(duration_sec*30)}/30s" hasVideo="1" hasAudio="1"/>
    </resources>
    <library>
        <event name="{base_name}">
            <project name="{base_name}_Resolve_Timeline">
                <sequence duration="{int(duration_sec*30)}/30s" format="r1">
                    <spine>
                        <asset-clip ref="a1" offset="0s" duration="{int(duration_sec*30)}/30s" name="{input_file.name}"/>
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>
'''
        xml_file.write_text(xml_content, encoding="utf-8")

        rel_srt = srt_file.relative_to(ROOT_DIR) if srt_file.is_relative_to(ROOT_DIR) else None
        rel_vtt = vtt_file.relative_to(ROOT_DIR) if vtt_file.is_relative_to(ROOT_DIR) else None
        rel_txt = txt_file.relative_to(ROOT_DIR) if txt_file.is_relative_to(ROOT_DIR) else None
        rel_xml = xml_file.relative_to(ROOT_DIR) if xml_file.is_relative_to(ROOT_DIR) else None

        return {
            "status": "success",
            "message": f"Subtitles & Resolve XML generated successfully using Whisper ({info.language.upper()})!",
            "detected_language": info.language,
            "output_directory": str(output_dir.resolve()),
            "srt_path": str(srt_file.resolve()),
            "srt_url": f"/media/{rel_srt.as_posix()}" if rel_srt else None,
            "vtt_path": str(vtt_file.resolve()),
            "vtt_url": f"/media/{rel_vtt.as_posix()}" if rel_vtt else None,
            "txt_path": str(txt_file.resolve()),
            "txt_url": f"/media/{rel_txt.as_posix()}" if rel_txt else None,
            "xml_path": str(xml_file.resolve()),
            "xml_url": f"/media/{rel_xml.as_posix()}" if rel_xml else None,
            "transcript_summary": "\n".join(txt_lines[:10]) + ("\n..." if len(txt_lines) > 10 else "")
        }

    except Exception as e:
        log_process_error(
            command=f"Whisper Transcribe ({req.whisper_model})",
            returncode=-1,
            stdout="",
            stderr=str(e),
            context_info="Feature C: Whisper Subtitles (Python Exception)"
        )
        raise HTTPException(
            status_code=500,
            detail="Subtitle generation failed. Check stash_error_log.txt for details."
        )

@app.post("/api/separate-audio")
async def separate_audio_stream(req: AudioSeparationRequest):
    """
    Feature A: Audio Separation (Demucs) with GPU acceleration and stop process support.
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

    async def event_generator():
        start_msg = f"Initializing {'NVIDIA GPU' if cuda_avail else 'CPU'} Engine ({model})..."
        yield f"data: {json.dumps({'type': 'start', 'message': start_msg, 'command': cmd_str})}\n\n"
        
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
            register_active_process(proc)

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
            clear_active_process()
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

        if done_item['returncode'] != 0:
            log_process_error(
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
        target_stem = req.stem_mode if req.stem_mode != "all_4_stems" else "vocals"
        primary_file = output_dir / f"{target_stem}.{file_ext}"
        no_target_file = output_dir / f"no_{target_stem}.{file_ext}"

        found_stems = {}
        if output_dir.exists():
            for f in output_dir.glob(f"*.{file_ext}"):
                rel_path = f.relative_to(ROOT_DIR) if f.is_relative_to(ROOT_DIR) else None
                found_stems[f.stem] = {
                    "abs_path": str(f.resolve()),
                    "web_url": f"/media/{rel_path.as_posix()}" if rel_path else None
                }

        primary_web_url = found_stems.get(target_stem, {}).get("web_url")
        no_target_web_url = found_stems.get(f"no_{target_stem}", {}).get("web_url")

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

@app.post("/api/convert-video")
async def convert_video_stream(req: VideoConversionRequest):
    """
    Feature B: Video Conversion (DaVinci Resolve) with stop process support.
    """
    clean_path = req.file_path.strip('"').strip("'")
    input_file = Path(clean_path)

    if not input_file.exists():
        raise HTTPException(status_code=400, detail=f"File not found at path: {clean_path}")

    container_ext = req.container.lower().lstrip(".")
    if req.output_path and req.output_path.strip():
        output_file = Path(req.output_path.strip('"').strip("'"))
    else:
        output_dir = ROOT_DIR / "converted"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / f"{input_file.stem}_resolve.{container_ext}"

    output_file.parent.mkdir(parents=True, exist_ok=True)

    audio_flags = ["-c:a", "pcm_s16le"] if req.audio_codec.lower() == "pcm" else ["-c:a", "aac", "-b:a", "320k"]
    cq_val = str(req.cq_quality)

    gpu_cmd = [
        "ffmpeg", "-y", "-i", str(input_file.resolve()),
        "-c:v", "h264_nvenc", "-preset", "p6", "-cq", cq_val,
        "-pix_fmt", "yuv420p"
    ] + audio_flags + [str(output_file.resolve())]
    gpu_cmd_str = " ".join([f'"{arg}"' if " " in arg else arg for arg in gpu_cmd])

    cpu_cmd = [
        "ffmpeg", "-y", "-i", str(input_file.resolve()),
        "-c:v", "libx264", "-preset", "fast", "-crf", cq_val,
        "-pix_fmt", "yuv420p"
    ] + audio_flags + [str(output_file.resolve())]
    cpu_cmd_str = " ".join([f'"{arg}"' if " " in arg else arg for arg in cpu_cmd])

    async def event_generator():
        yield f"data: {json.dumps({'type': 'start', 'message': 'Converting video for DaVinci Resolve...', 'command': gpu_cmd_str})}\n\n"

        time_pattern = re.compile(r'time=(\d+):(\d+):(\d+.\d+)')

        def run_command_worker(cmd, q, mode_label):
            proc = subprocess.Popen(
                cmd,
                cwd=str(ROOT_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace"
            )
            register_active_process(proc)

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
                    pct = min(98, int((curr_seconds / 120.0) * 100))
                    q.put({
                        'type': 'progress',
                        'percent': pct,
                        'text': f"Encoding video ({mode_label}) ({pct}%)..."
                    })
            proc.wait()
            clear_active_process()
            q.put({'type': 'done', 'returncode': proc.returncode, 'stderr': "".join(stderr_buf)})

        # Attempt 1: GPU Accelerated
        q_gpu = queue.Queue()
        threading.Thread(target=run_command_worker, args=(gpu_cmd, q_gpu, "GPU NVENC"), daemon=True).start()

        done_gpu = None
        while done_gpu is None:
            await asyncio.sleep(0.1)
            while not q_gpu.empty():
                item = q_gpu.get_nowait()
                if item['type'] == 'progress':
                    yield f"data: {json.dumps(item)}\n\n"
                elif item['type'] == 'done':
                    done_gpu = item

        if done_gpu['returncode'] == 0:
            rel_path = output_file.relative_to(ROOT_DIR) if output_file.is_relative_to(ROOT_DIR) else None
            success_evt = json.dumps({
                'type': 'complete',
                'percent': 100,
                'result': {
                    "status": "success",
                    "mode": "GPU (h264_nvenc)",
                    "message": f"Video converted to .{container_ext.upper()} successfully using GPU acceleration!",
                    "command_executed": gpu_cmd_str,
                    "output_file": str(output_file.resolve()),
                    "web_url": f"/media/{rel_path.as_posix()}" if rel_path else None
                }
            })
            yield f"data: {success_evt}\n\n"
            return

        # Attempt 2: CPU Fallback
        yield f"data: {json.dumps({'type': 'progress', 'percent': 10, 'text': 'GPU unavailable. Initiating CPU (libx264) fallback...'})}\n\n"
        
        q_cpu = queue.Queue()
        threading.Thread(target=run_command_worker, args=(cpu_cmd, q_cpu, "CPU Fallback"), daemon=True).start()

        done_cpu = None
        while done_cpu is None:
            await asyncio.sleep(0.1)
            while not q_cpu.empty():
                item = q_cpu.get_nowait()
                if item['type'] == 'progress':
                    yield f"data: {json.dumps(item)}\n\n"
                elif item['type'] == 'done':
                    done_cpu = item

        if done_cpu['returncode'] == 0:
            rel_path = output_file.relative_to(ROOT_DIR) if output_file.is_relative_to(ROOT_DIR) else None
            success_evt = json.dumps({
                'type': 'complete',
                'percent': 100,
                'result': {
                    "status": "success",
                    "mode": "CPU Fallback (libx264)",
                    "message": f"Converted to .{container_ext.upper()} using CPU fallback!",
                    "command_executed": cpu_cmd_str,
                    "output_file": str(output_file.resolve()),
                    "web_url": f"/media/{rel_path.as_posix()}" if rel_path else None
                }
            })
            yield f"data: {success_evt}\n\n"
            return

        # Both Failed
        error_log_content = (
            "--- ATTEMPT 1: GPU (h264_nvenc) ---\n"
            f"Command: {gpu_cmd_str}\nStderr: {done_gpu['stderr']}\n\n"
            "--- ATTEMPT 2: CPU Fallback (libx264) ---\n"
            f"Command: {cpu_cmd_str}\nStderr: {done_cpu['stderr']}\n"
        )
        log_process_error(
            command=f"Primary: {gpu_cmd_str}\nFallback: {cpu_cmd_str}",
            returncode=done_cpu['returncode'],
            stdout="",
            stderr=error_log_content,
            context_info="Feature B: Video Conversion (GPU + CPU Failure)"
        )
        err_evt = json.dumps({
            'type': 'error',
            'message': 'Process stopped by user or interrupted.'
        })
        yield f"data: {err_evt}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/convert-audio")
def convert_audio(req: AudioConversionRequest):
    """
    Universal Audio Converter: Converts any audio file format to MP3, WAV, FLAC, AAC, OGG, M4A, ALAC, AIFF.
    """
    clean_path = req.file_path.strip('"').strip("'")
    input_file = Path(clean_path)

    if not input_file.exists():
        raise HTTPException(status_code=400, detail=f"File not found at path: {clean_path}")

    target_ext = req.target_format.lower().lstrip(".")
    output_dir = ROOT_DIR / "converted_audio"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_file = output_dir / f"{input_file.stem}_converted.{target_ext}"

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

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        register_active_process(proc)
        stdout, stderr = proc.communicate()
        clear_active_process()

        if proc.returncode != 0:
            log_process_error(
                command=cmd_str,
                returncode=proc.returncode,
                stdout=stdout,
                stderr=stderr,
                context_info=f"Audio Converter ({target_ext.upper()})"
            )
            raise HTTPException(
                status_code=500,
                detail="Processing Failed. Check stash_error_log.txt for details."
            )

        rel_path = output_file.relative_to(ROOT_DIR) if output_file.is_relative_to(ROOT_DIR) else None
        return {
            "status": "success",
            "message": f"Audio converted to .{target_ext.upper()} successfully!",
            "command_executed": cmd_str,
            "output_file": str(output_file.resolve()),
            "web_url": f"/media/{rel_path.as_posix()}" if rel_path else None
        }
    except HTTPException:
        raise
    except Exception as e:
        log_process_error(
            command=cmd_str,
            returncode=-1,
            stdout="",
            stderr=str(e),
            context_info="Audio Converter (Python Exception)"
        )
        raise HTTPException(
            status_code=500,
            detail="Processing Failed. Check stash_error_log.txt for details."
        )

@app.get("/api/pick-file")
def pick_file_dialog():
    """Launches local OS file picker window supporting ALL video and audio file formats."""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        
        file_path = filedialog.askopenfilename(
            title="Select Any Audio or Video File for Demuxer",
            filetypes=[
                ("All Files (*.*)", "*.*"),
                ("All Audio Files", "*.mp3 *.wav *.flac *.aac *.m4a *.ogg *.opus *.wma *.alac *.aiff *.pcm *.amr *.caf *.MP3 *.WAV *.FLAC *.AAC *.M4A"),
                ("All Video Files", "*.mp4 *.mkv *.avi *.mov *.wmv *.flv *.m4v *.webm *.ts *.mts *.m2ts *.3gp *.ogv *.MP4 *.MKV *.AVI *.MOV *.WMV *.WEBM")
            ]
        )
        root.destroy()
        
        if file_path:
            normalized = str(Path(file_path).resolve())
            return {"status": "success", "file_path": normalized}
        return {"status": "cancelled", "file_path": ""}
    except Exception as e:
        return {"status": "error", "error": str(e), "file_path": ""}

@app.get("/api/pick-folder")
def pick_folder_dialog():
    """Launches local OS folder picker window using Tkinter."""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        
        folder_path = filedialog.askdirectory(title="Select Output Folder")
        root.destroy()
        
        if folder_path:
            normalized = str(Path(folder_path).resolve())
            return {"status": "success", "folder_path": normalized}
        return {"status": "cancelled", "folder_path": ""}
    except Exception as e:
        return {"status": "error", "error": str(e), "folder_path": ""}

@app.get("/api/logs")
def get_stash_logs(response: Response):
    """Returns content of stash_error_log.txt with no-cache headers."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"

    if not LOG_FILE_PATH.exists():
        return {"exists": False, "content": "No error log entries recorded yet. (stash_error_log.txt is clear)"}
    
    try:
        content = LOG_FILE_PATH.read_text(encoding="utf-8", errors="replace")
        return {"exists": True, "content": content if content.strip() else "Log file is empty."}
    except Exception as e:
        return {"exists": False, "content": f"Failed to read log file: {str(e)}"}

@app.delete("/api/logs")
def clear_stash_logs(response: Response):
    """Clears stash_error_log.txt."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    try:
        LOG_FILE_PATH.write_text("# DEMUXER STASH ERROR LOG\n# Clear.\n", encoding="utf-8")
        return {"status": "success", "message": "Log file cleared successfully."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/open-folder")
def open_folder(req: OpenFolderRequest):
    """Opens folder in Windows Explorer."""
    path_obj = Path(req.folder_path)
    target = path_obj.parent if path_obj.is_file() else path_obj
    
    if not target.exists():
        target.mkdir(parents=True, exist_ok=True)
        
    try:
        os.startfile(str(target))
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
