# DEMUXER PRO v3 🚀
> **Local AI Audio Separation & Lossless DaVinci Resolve Converter Suite**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-3.11%2B-brightgreen.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688.svg)
![React](https://img.shields.io/badge/React-18.0%2B-61DAFB.svg)
![PyTorch CUDA](https://img.shields.io/badge/PyTorch-CUDA%2012.1-EE4C2C.svg)
![FFmpeg](https://img.shields.io/badge/FFmpeg-GPU%20NVENC-0078D7.svg)

---

## ⚡ Highlights & Key Features

* 🎤 **Demucs AI Stem Separation**:
  * Powered by Meta AI's **`htdemucs_ft`** (Fine-Tuned Hybrid Transformer) model.
  * **Quality Shifts Boost** (`--shifts 2`) eliminates phase artifacts and background bleeding.
  * Extract **Vocals**, **Background Instrumental**, **Drums**, **Bass**, or **Full 4 Stems**.
  * Choice of output formats: **MP3 (320 kbps)**, **WAV (Lossless 16-bit)**, or **FLAC**.

* 🎛️ **Synchronized Dual-Stem Live Mixer**:
  * Play, seek, and mix **Vocals** vs **Background Instrumental** directly in your browser.
  * Independent **Volume Faders**, **MUTE**, and **SOLO** buttons.

* 🎬 **DaVinci Resolve Lossless Video Converter**:
  * **NVIDIA NVENC GPU Acceleration** (`h264_nvenc`) with automatic CPU fallback (`libx264`).
  * Custom container format: **`.MP4`**, **`.MOV`**, or **`.MKV`**.
  * Adjustable CRF quality (`18` Visually Lossless, `14` Max Quality, `22`).
  * Professional audio track codecs: **AAC 320 kbps** or **PCM 16-bit Uncompressed WAV** (DaVinci Resolve Native).

* 🎛️ **Universal Audio Converter**:
  * Convert any audio or video file to **WAV**, **MP3**, **FLAC**, **AAC**, **M4A**, **OGG**, or **AIFF**.

* 📊 **Real-Time Progress & Process Control**:
  * **Real-time SSE Streaming**: Smooth animated progress bar (`0%` → `100%`).
  * ⏹️ **One-Click Stop Process**: Terminate any background CLI task instantly from the UI.
  * 🚨 **Stash Error Log Monitor**: Glowing unread error badge and in-app viewer/clearer for `stash_error_log.txt`.

---

## 🚀 Single-Click Quick Start

### Windows (Easiest)
Simply **double-click** the launcher script in the project root:
```cmd
start_engine.bat
```

### PowerShell
Or run in your terminal:
```powershell
.\start_engine.ps1
```

> **Dashboard**: Open `http://localhost:5173` in your browser.  
> **API Server**: Runs automatically on `http://localhost:8000`.

---

## 🛠️ Manual Installation & Setup

### Prerequisites
1. **Python 3.11+**
2. **Node.js 18+**
3. **FFmpeg** installed and added to system `PATH`.
4. *(Optional for GPU acceleration)* **NVIDIA GPU** with CUDA drivers.

### 1. Backend Setup
```bash
cd backend
python -m pip install -r requirements.txt

# For NVIDIA GPU CUDA acceleration:
python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

python -m uvicorn main:app --reload --port 8000
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

---

## 📁 Repository Structure

```text
Demuxer/
├── start_engine.bat         # Single-click Windows launcher
├── start_engine.ps1         # PowerShell launcher script
├── notes.txt                # Technical requirements & specs
├── stash_error_log.txt      # Automated raw process error log
├── README.md                # Project documentation
├── .gitignore               # Git exclusions
├── backend/
│   ├── main.py              # FastAPI server & CLI subprocess engine
│   └── requirements.txt     # Python dependencies
└── frontend/
    ├── package.json         # Frontend packages & scripts
    ├── vite.config.js       # Vite configuration
    └── src/
        ├── App.jsx          # React Pro Dashboard & Audio Mixer
        ├── index.css        # Obsidian Glassmorphic styling
        └── main.jsx         # Entrypoint
```

---

## 📜 License
Released under the **MIT License**. Built for high-performance audio separation and video editing workflows.
