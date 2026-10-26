import re
import json
import uuid
import queue
import asyncio
import threading
import subprocess
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from utils.process import process_manager, probe_media_duration, check_nvenc_available
from utils.whisper_utils import log_process_error

router = APIRouter(prefix="/api", tags=["Video"])

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
LOG_FILE_PATH = ROOT_DIR / "stash_error_log.txt"

class VideoConversionRequest(BaseModel):
    file_path: str
    container: str = "mp4"
    mode: str = "transcode"  # "transcode" (Default: libx264 8-bit CRF 18 for Resolve Free), "remux" (Stream Copy), or "gpu_nvenc"
    cq_quality: int = 18
    audio_codec: str = "aac"
    output_path: Optional[str] = None

@router.post("/convert-video")
async def convert_video_stream(req: VideoConversionRequest):
    """
    Feature B: Video Conversion (DaVinci Resolve) with accurate progress probing,
    upfront NVENC capability check to prevent 2x double-encoding penalty, and process tree cancellation.
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

    audio_flags = ["-c:a", "pcm_s24le"] if req.audio_codec.lower() == "pcm" else ["-c:a", "aac", "-b:a", "320k"]
    cq_val = str(req.cq_quality)

    # Probe real duration (Fixes bug #1)
    real_duration = probe_media_duration(str(input_file))

    # 1. Primary DaVinci Resolve Free 8-bit Transcode Command (Exact user command)
    # ffmpeg -i input.mkv -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 320k output.mp4
    resolve_cmd = [
        "ffmpeg", "-y", "-i", str(input_file.resolve()),
        "-c:v", "libx264", "-crf", cq_val,
        "-pix_fmt", "yuv420p"
    ] + audio_flags
    if container_ext in ["mp4", "mov", "m4v"]:
        resolve_cmd.extend(["-movflags", "+faststart"])
    resolve_cmd.append(str(output_file.resolve()))
    resolve_cmd_str = " ".join([f'"{arg}"' if " " in arg else arg for arg in resolve_cmd])

    # 2. Base remux command: -c copy (direct stream copy, for 8-bit files)
    remux_cmd = [
        "ffmpeg", "-y", "-i", str(input_file.resolve()),
        "-map", "0:v:0", "-map", "0:a?",
        "-c", "copy"
    ]
    if container_ext in ["mp4", "mov", "m4v"]:
        remux_cmd.extend(["-movflags", "+faststart"])
    remux_cmd.append(str(output_file.resolve()))
    remux_cmd_str = " ".join([f'"{arg}"' if " " in arg else arg for arg in remux_cmd])

    # 3. Smart remux command: copy video bit-for-bit, transcode audio to Resolve-compatible AAC/PCM
    smart_remux_cmd = [
        "ffmpeg", "-y", "-i", str(input_file.resolve()),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "copy"
    ] + audio_flags
    if container_ext in ["mp4", "mov", "m4v"]:
        smart_remux_cmd.extend(["-movflags", "+faststart"])
    smart_remux_cmd.append(str(output_file.resolve()))
    smart_remux_cmd_str = " ".join([f'"{arg}"' if " " in arg else arg for arg in smart_remux_cmd])

    # 4. GPU re-encode command (NVENC)
    gpu_cmd = [
        "ffmpeg", "-y", "-hwaccel", "cuda", 
        "-i", str(input_file.resolve()),
        "-c:v", "h264_nvenc", "-preset", "p6", "-cq", cq_val,
        "-pix_fmt", "yuv420p"
    ] + audio_flags
    if container_ext in ["mp4", "mov", "m4v"]:
        gpu_cmd.extend(["-movflags", "+faststart"])
    gpu_cmd.append(str(output_file.resolve()))
    gpu_cmd_str = " ".join([f'"{arg}"' if " " in arg else arg for arg in gpu_cmd])

    job_id = f"vidconv_{uuid.uuid4().hex[:8]}"

    # Check NVENC encoder availability upfront (Fixes bug #2)
    nvenc_supported = check_nvenc_available()
    req_mode = req.mode.lower()
    is_remux_mode = req_mode == "remux"
    is_gpu_mode = req_mode == "gpu_nvenc"
    is_transcode_mode = not is_remux_mode and not is_gpu_mode

    async def event_generator():
        if is_transcode_mode:
            initial_msg = f"Transcoding video to 8-bit H.264 (libx264 CRF {cq_val}) for DaVinci Resolve Free..."
            initial_cmd = resolve_cmd_str
        elif is_remux_mode:
            initial_msg = "Remuxing video streams directly (-c copy)..."
            initial_cmd = remux_cmd_str
        elif is_gpu_mode:
            initial_msg = "Converting video with GPU acceleration (NVENC)..."
            initial_cmd = gpu_cmd_str
        else:
            initial_msg = "Transcoding video for DaVinci Resolve..."
            initial_cmd = resolve_cmd_str

        yield f"data: {json.dumps({'type': 'start', 'job_id': job_id, 'message': initial_msg, 'command': initial_cmd})}\n\n"

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
                    if real_duration and real_duration > 0:
                        pct = min(98, max(2, int((curr_seconds / real_duration) * 100)))
                    else:
                        pct = min(98, max(2, int((curr_seconds / 120.0) * 100)))
                    q.put({
                        'type': 'progress',
                        'percent': pct,
                        'text': f"Processing video ({mode_label}) ({pct}%)..."
                    })
            proc.wait()
            process_manager.unregister_process(job_id)
            q.put({'type': 'done', 'returncode': proc.returncode, 'stderr': "".join(stderr_buf)})

        def cleanup_cancelled_file():
            if output_file.exists():
                try:
                    output_file.unlink()
                except Exception:
                    pass

        # === 1. TRANSCODE MODE (DEFAULT: libx264 -crf 18 -pix_fmt yuv420p) ===
        if is_transcode_mode:
            q_trans = queue.Queue()
            threading.Thread(target=run_command_worker, args=(resolve_cmd, q_trans, "Resolve 8-bit libx264"), daemon=True).start()

            done_trans = None
            while done_trans is None:
                await asyncio.sleep(0.1)
                while not q_trans.empty():
                    item = q_trans.get_nowait()
                    if item['type'] == 'progress':
                        yield f"data: {json.dumps(item)}\n\n"
                    elif item['type'] == 'done':
                        done_trans = item

            if process_manager.is_cancelled(job_id):
                cleanup_cancelled_file()
                err_evt = json.dumps({'type': 'error', 'message': 'Process stopped by user.'})
                yield f"data: {err_evt}\n\n"
                return

            if done_trans['returncode'] == 0:
                rel_path = output_file.relative_to(ROOT_DIR / "converted") if output_file.is_relative_to(ROOT_DIR / "converted") else None
                web_url = f"/media/converted/{rel_path.as_posix()}" if rel_path else None
                success_evt = json.dumps({
                    'type': 'complete',
                    'percent': 100,
                    'result': {
                        "status": "success",
                        "mode": f"Resolve 8-bit (libx264 CRF {cq_val})",
                        "message": f"Video successfully transcoded to 8-bit H.264 (CRF {cq_val}) for DaVinci Resolve!",
                        "command_executed": resolve_cmd_str,
                        "output_file": str(output_file.resolve()),
                        "web_url": web_url
                    }
                })
                yield f"data: {success_evt}\n\n"
                return

            # Failed
            error_log_content = (
                f"Command: {resolve_cmd_str}\nStderr: {done_trans['stderr']}\n"
            )
            log_process_error(
                log_file_path=LOG_FILE_PATH,
                command=resolve_cmd_str,
                returncode=done_trans['returncode'],
                stdout="",
                stderr=error_log_content,
                context_info="Feature B: Resolve Transcode Failure"
            )
            err_evt = json.dumps({
                'type': 'error',
                'message': 'Video transcoding failed. Check stash_error_log.txt for details.'
            })
            yield f"data: {err_evt}\n\n"
            return

        # === 2. REMUX MODE (Direct Stream Copy -c copy) ===
        if is_remux_mode:
            wants_pcm = req.audio_codec.lower() == "pcm"
            first_cmd = smart_remux_cmd if wants_pcm else remux_cmd
            first_label = "Lossless Video Copy + PCM 24-bit" if wants_pcm else "Direct Stream Copy -c copy"
            first_cmd_str = smart_remux_cmd_str if wants_pcm else remux_cmd_str

            q_remux = queue.Queue()
            threading.Thread(target=run_command_worker, args=(first_cmd, q_remux, first_label), daemon=True).start()

            done_remux = None
            while done_remux is None:
                await asyncio.sleep(0.05)
                while not q_remux.empty():
                    item = q_remux.get_nowait()
                    if item['type'] == 'progress':
                        yield f"data: {json.dumps(item)}\n\n"
                    elif item['type'] == 'done':
                        done_remux = item

            if process_manager.is_cancelled(job_id):
                cleanup_cancelled_file()
                err_evt = json.dumps({'type': 'error', 'message': 'Process stopped by user.'})
                yield f"data: {err_evt}\n\n"
                return

            if done_remux['returncode'] == 0:
                rel_path = output_file.relative_to(ROOT_DIR / "converted") if output_file.is_relative_to(ROOT_DIR / "converted") else None
                web_url = f"/media/converted/{rel_path.as_posix()}" if rel_path else None
                success_msg = (
                    f"Video remuxed lossless to .{container_ext.upper()} with uncompressed 24-bit PCM audio for DaVinci Resolve!"
                    if wants_pcm
                    else f"Video remuxed to .{container_ext.upper()} in seconds without quality loss or size increase!"
                )
                success_evt = json.dumps({
                    'type': 'complete',
                    'percent': 100,
                    'result': {
                        "status": "success",
                        "mode": first_label,
                        "message": success_msg,
                        "command_executed": first_cmd_str,
                        "output_file": str(output_file.resolve()),
                        "web_url": web_url
                    }
                })
                yield f"data: {success_evt}\n\n"
                return

            # Fallback to smart remux if audio copy failed
            if not wants_pcm:
                yield f"data: {json.dumps({'type': 'progress', 'percent': 10, 'text': 'Direct audio stream copy incompatible with container. Retrying with video copy + audio transcode...'})}\n\n"
                q_smart = queue.Queue()
                threading.Thread(target=run_command_worker, args=(smart_remux_cmd, q_smart, "Video Copy + Audio Transcode"), daemon=True).start()

                done_smart = None
                while done_smart is None:
                    await asyncio.sleep(0.05)
                    while not q_smart.empty():
                        item = q_smart.get_nowait()
                        if item['type'] == 'progress':
                            yield f"data: {json.dumps(item)}\n\n"
                        elif item['type'] == 'done':
                            done_smart = item

                if process_manager.is_cancelled(job_id):
                    cleanup_cancelled_file()
                    err_evt = json.dumps({'type': 'error', 'message': 'Process stopped by user.'})
                    yield f"data: {err_evt}\n\n"
                    return

                if done_smart['returncode'] == 0:
                    rel_path = output_file.relative_to(ROOT_DIR / "converted") if output_file.is_relative_to(ROOT_DIR / "converted") else None
                    web_url = f"/media/converted/{rel_path.as_posix()}" if rel_path else None
                    success_evt = json.dumps({
                        'type': 'complete',
                        'percent': 100,
                        'result': {
                            "status": "success",
                            "mode": "Smart Remux (Video Copy + Audio Transcode)",
                            "message": f"Video stream copied lossless to .{container_ext.upper()} with audio encoded for DaVinci Resolve!",
                            "command_executed": smart_remux_cmd_str,
                            "output_file": str(output_file.resolve()),
                            "web_url": web_url
                        }
                    })
                    yield f"data: {success_evt}\n\n"
                    return

            yield f"data: {json.dumps({'type': 'progress', 'percent': 15, 'text': 'Stream copy unsupported. Falling back to Resolve 8-bit libx264 transcode...'})}\n\n"
            # Fallback to resolve_cmd
            q_cpu = queue.Queue()
            threading.Thread(target=run_command_worker, args=(resolve_cmd, q_cpu, "Resolve 8-bit libx264"), daemon=True).start()
            done_cpu = None
            while done_cpu is None:
                await asyncio.sleep(0.1)
                while not q_cpu.empty():
                    item = q_cpu.get_nowait()
                    if item['type'] == 'progress':
                        yield f"data: {json.dumps(item)}\n\n"
                    elif item['type'] == 'done':
                        done_cpu = item

            if process_manager.is_cancelled(job_id):
                cleanup_cancelled_file()
                err_evt = json.dumps({'type': 'error', 'message': 'Process stopped by user.'})
                yield f"data: {err_evt}\n\n"
                return

            if done_cpu['returncode'] == 0:
                rel_path = output_file.relative_to(ROOT_DIR / "converted") if output_file.is_relative_to(ROOT_DIR / "converted") else None
                web_url = f"/media/converted/{rel_path.as_posix()}" if rel_path else None
                success_evt = json.dumps({
                    'type': 'complete',
                    'percent': 100,
                    'result': {
                        "status": "success",
                        "mode": f"Resolve 8-bit (libx264 CRF {cq_val})",
                        "message": f"Video converted to 8-bit H.264 for DaVinci Resolve!",
                        "command_executed": resolve_cmd_str,
                        "output_file": str(output_file.resolve()),
                        "web_url": web_url
                    }
                })
                yield f"data: {success_evt}\n\n"
                return

            err_evt = json.dumps({'type': 'error', 'message': 'Video conversion failed. Check stash_error_log.txt for details.'})
            yield f"data: {err_evt}\n\n"
            return

        # === 3. GPU NVENC MODE ===
        if is_gpu_mode and nvenc_supported:
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

            if process_manager.is_cancelled(job_id):
                cleanup_cancelled_file()
                err_evt = json.dumps({'type': 'error', 'message': 'Process stopped by user.'})
                yield f"data: {err_evt}\n\n"
                return

            if done_gpu['returncode'] == 0:
                rel_path = output_file.relative_to(ROOT_DIR / "converted") if output_file.is_relative_to(ROOT_DIR / "converted") else None
                web_url = f"/media/converted/{rel_path.as_posix()}" if rel_path else None
                success_evt = json.dumps({
                    'type': 'complete',
                    'percent': 100,
                    'result': {
                        "status": "success",
                        "mode": "GPU (h264_nvenc)",
                        "message": f"Video converted to .{container_ext.upper()} successfully using GPU acceleration!",
                        "command_executed": gpu_cmd_str,
                        "output_file": str(output_file.resolve()),
                        "web_url": web_url
                    }
                })
                yield f"data: {success_evt}\n\n"
                return

            yield f"data: {json.dumps({'type': 'progress', 'percent': 20, 'text': 'GPU NVENC failed. Falling back to Resolve 8-bit libx264...'})}\n\n"

        # Fallback to resolve_cmd if GPU failed
        q_cpu = queue.Queue()
        threading.Thread(target=run_command_worker, args=(resolve_cmd, q_cpu, "Resolve 8-bit libx264"), daemon=True).start()
        done_cpu = None
        while done_cpu is None:
            await asyncio.sleep(0.1)
            while not q_cpu.empty():
                item = q_cpu.get_nowait()
                if item['type'] == 'progress':
                    yield f"data: {json.dumps(item)}\n\n"
                elif item['type'] == 'done':
                    done_cpu = item

        if process_manager.is_cancelled(job_id):
            cleanup_cancelled_file()
            err_evt = json.dumps({'type': 'error', 'message': 'Process stopped by user.'})
            yield f"data: {err_evt}\n\n"
            return

        if done_cpu['returncode'] == 0:
            rel_path = output_file.relative_to(ROOT_DIR / "converted") if output_file.is_relative_to(ROOT_DIR / "converted") else None
            web_url = f"/media/converted/{rel_path.as_posix()}" if rel_path else None
            success_evt = json.dumps({
                'type': 'complete',
                'percent': 100,
                'result': {
                    "status": "success",
                    "mode": f"Resolve 8-bit (libx264 CRF {cq_val})",
                    "message": f"Video converted to .{container_ext.upper()} successfully using CPU encoder!",
                    "command_executed": resolve_cmd_str,
                    "output_file": str(output_file.resolve()),
                    "web_url": web_url
                }
            })
            yield f"data: {success_evt}\n\n"
            return

        # Failed
        error_log_content = (
            f"Command: {resolve_cmd_str}\nStderr: {done_cpu['stderr']}\n"
        )
        log_process_error(
            log_file_path=LOG_FILE_PATH,
            command=resolve_cmd_str,
            returncode=done_cpu['returncode'],
            stdout="",
            stderr=error_log_content,
            context_info="Feature B: Resolve Transcode Failure"
        )
        err_evt = json.dumps({
            'type': 'error',
            'message': 'Video conversion failed. Check stash_error_log.txt for details.'
        })
        yield f"data: {err_evt}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
