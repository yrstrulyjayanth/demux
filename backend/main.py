import sys
import asyncio
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import system, audio, video, subtitles

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

# Create output media directories safely
separated_dir = ROOT_DIR / "separated"
converted_dir = ROOT_DIR / "converted"
converted_audio_dir = ROOT_DIR / "converted_audio"
subtitles_dir = ROOT_DIR / "subtitles"

for d in [separated_dir, converted_dir, converted_audio_dir, subtitles_dir]:
    d.mkdir(parents=True, exist_ok=True)

# Mount ONLY dedicated output folders (Fixes bug #10: no project root static leak)
app.mount("/media/separated", StaticFiles(directory=str(separated_dir)), name="media_separated")
app.mount("/media/converted", StaticFiles(directory=str(converted_dir)), name="media_converted")
app.mount("/media/converted_audio", StaticFiles(directory=str(converted_audio_dir)), name="media_converted_audio")
app.mount("/media/subtitles", StaticFiles(directory=str(subtitles_dir)), name="media_subtitles")

# Register routers
app.include_router(system.router)
app.include_router(audio.router)
app.include_router(video.router)
app.include_router(subtitles.router)
