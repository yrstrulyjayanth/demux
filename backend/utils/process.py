import os
import sys
import subprocess
import threading
from pathlib import Path
from typing import Optional, Dict

class ProcessManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._active_processes: Dict[str, subprocess.Popen] = {}
        self._cancelled_jobs: set = set()

    def register_process(self, job_id: str, proc: subprocess.Popen):
        with self._lock:
            self._active_processes[job_id] = proc
            self._cancelled_jobs.discard(job_id)

    def unregister_process(self, job_id: str):
        with self._lock:
            self._active_processes.pop(job_id, None)

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancelled_jobs

    def cancel_job(self, job_id: str):
        with self._lock:
            self._cancelled_jobs.add(job_id)
            proc = self._active_processes.get(job_id)
            if proc:
                kill_process_tree(proc)

    def stop_all(self):
        with self._lock:
            for job_id, proc in list(self._active_processes.items()):
                self._cancelled_jobs.add(job_id)
                kill_process_tree(proc)

    def has_active_processes(self) -> bool:
        with self._lock:
            return any(proc.poll() is None for proc in self._active_processes.values())

process_manager = ProcessManager()

def kill_process_tree(proc: subprocess.Popen):
    """Kills a process and all of its subprocesses (process tree) cleanly."""
    if proc is None or proc.poll() is not None:
        return

    pid = proc.pid
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False
            )
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    else:
        try:
            proc.kill()
        except Exception:
            pass

def probe_media_duration(file_path: str) -> Optional[float]:
    """Probes the exact duration of a video or audio file in seconds using ffprobe."""
    clean_path = file_path.strip('"').strip("'")
    p = Path(clean_path)
    if not p.exists():
        return None

    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(p.resolve())
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
        if res.returncode == 0 and res.stdout.strip():
            val = float(res.stdout.strip())
            return val if val > 0 else None
    except Exception:
        pass
    return None

def check_nvenc_available() -> bool:
    """Checks if ffmpeg supports h264_nvenc encoding on the current system."""
    try:
        res = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
        if res.returncode == 0 and "h264_nvenc" in res.stdout:
            # Also attempt a zero-frame dry run test
            test_cmd = [
                "ffmpeg", "-hide_banner", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
                "-c:v", "h264_nvenc",
                "-f", "null", "-"
            ]
            test_res = subprocess.run(test_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
            return test_res.returncode == 0
    except Exception:
        pass
    return False
