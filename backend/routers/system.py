import os
import subprocess
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Response, HTTPException
from pydantic import BaseModel

from utils.process import process_manager

router = APIRouter(prefix="/api", tags=["System"])

# Root directory of project
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
LOG_FILE_PATH = ROOT_DIR / "stash_error_log.txt"

class FileInfoRequest(BaseModel):
    file_path: str

class OpenFolderRequest(BaseModel):
    folder_path: str

class StopProcessRequest(BaseModel):
    job_id: Optional[str] = None

@router.get("/health")
def check_health(response: Response):
    """Returns engine health and environment checks."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    ffmpeg_installed = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode == 0
    demucs_installed = subprocess.run(["demucs", "--help"], stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode == 0

    has_whisper = False
    try:
        import faster_whisper
        has_whisper = True
    except Exception:
        try:
            import whisper
            has_whisper = True
        except Exception:
            pass
    
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
        "whisper": has_whisper,
        "cuda_available": cuda_avail,
        "gpu_device": device_name,
        "has_unread_errors": has_errors,
        "is_busy": process_manager.has_active_processes()
    }

@router.post("/stop-process")
def stop_current_process(req: Optional[StopProcessRequest] = None):
    """Instantly kills running Demucs, FFmpeg, or Whisper subprocess trees."""
    job_id = req.job_id if req and req.job_id else None
    if job_id:
        process_manager.cancel_job(job_id)
        return {"status": "success", "message": f"Process job '{job_id}' terminated successfully."}
    else:
        process_manager.stop_all()
        return {"status": "success", "message": "All active processes terminated successfully."}

@router.post("/file-info")
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

@router.get("/pick-file")
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

@router.get("/pick-folder")
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

@router.get("/logs")
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

@router.delete("/logs")
def clear_stash_logs(response: Response):
    """Clears stash_error_log.txt."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    try:
        LOG_FILE_PATH.write_text("# DEMUXER STASH ERROR LOG\n# Clear.\n", encoding="utf-8")
        return {"status": "success", "message": "Log file cleared successfully."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/open-folder")
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
