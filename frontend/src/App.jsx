import React, { useState, useEffect } from 'react';
import { 
  Waves, 
  Film, 
  Music, 
  AlertCircle, 
  Terminal, 
  Zap, 
  CheckCircle2, 
  Sparkles,
  Sliders,
  History,
  ShieldCheck,
  Disc,
  ArrowRight,
  FileText,
  Sparkle
} from 'lucide-react';

import { useSSE } from './hooks/useSSE';
import FilePicker from './components/FilePicker';
import ProgressBar from './components/ProgressBar';
import ResultCard from './components/ResultCard';
import StemMixer from './components/StemMixer';
import LogModal from './components/LogModal';
import HistoryList from './components/HistoryList';

const API_BASE = 'http://localhost:8000';

export default function App() {
  const [filePath, setFilePath] = useState('');
  const [customOutputDir, setCustomOutputDir] = useState('');
  const [fileMetadata, setFileMetadata] = useState(null);

  // Audio Separation Options
  const [modelName, setModelName] = useState('htdemucs_ft');
  const [stemMode, setStemMode] = useState('vocals');
  const [audioFormat, setAudioFormat] = useState('mp3');
  const [mp3Bitrate, setMp3Bitrate] = useState(320);
  const [shiftsQuality, setShiftsQuality] = useState(2);

  // Video Conversion Options
  const [videoContainer, setVideoContainer] = useState('mp4');
  const [videoMode, setVideoMode] = useState('transcode');
  const [cqQuality, setCqQuality] = useState(18);
  const [videoAudioCodec, setVideoAudioCodec] = useState('aac');

  // Audio Converter Options
  const [targetAudioFormat, setTargetAudioFormat] = useState('wav');

  // Whisper Subtitles Options
  const [whisperModel, setWhisperModel] = useState('large-v3');
  const [subtitleLanguage, setSubtitleLanguage] = useState('auto');
  const [resolveTextType, setResolveTextType] = useState('text_plus');
  const [genSrt, setGenSrt] = useState(true);
  const [genVtt, setGenVtt] = useState(true);
  const [genTxt, setGenTxt] = useState(true);
  const [genResolveSubXml, setGenResolveSubXml] = useState(false);
  const [genResolveTimelineXml, setGenResolveTimelineXml] = useState(false);
  const [demucsVocalClean, setDemucsVocalClean] = useState(true);

  // Health & System state
  const [serverHealth, setServerHealth] = useState({ online: false, ffmpeg: false, demucs: false, whisper: false, cuda: false, gpuDevice: '' });
  const [hasUnreadError, setHasUnreadError] = useState(false);
  
  // Results & History
  const [resultData, setResultData] = useState(null);
  const [jobHistory, setJobHistory] = useState([]);

  // Log Modal
  const [showLogModal, setShowLogModal] = useState(false);
  const [logContent, setLogContent] = useState('');

  // SSE Hook
  const {
    isProcessing,
    progressPercent,
    activeTask,
    liveLogText,
    errorMessage,
    startStream,
    stopStream,
    setErrorMessage
  } = useSSE(API_BASE);

  // Load History
  useEffect(() => {
    try {
      const saved = localStorage.getItem('demuxer_history');
      if (saved) setJobHistory(JSON.parse(saved));
    } catch (e) {
      console.error('History load error:', e);
    }
  }, []);

  const saveToHistory = (item) => {
    setJobHistory(prev => {
      const updated = [item, ...prev.slice(0, 9)];
      try {
        localStorage.setItem('demuxer_history', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const handleClearHistory = () => {
    setJobHistory([]);
    try { localStorage.removeItem('demuxer_history'); } catch (e) {}
  };

  // Health Check
  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setServerHealth({ 
          online: true, 
          ffmpeg: data.ffmpeg, 
          demucs: data.demucs,
          whisper: data.whisper,
          cuda: data.cuda_available,
          gpuDevice: data.gpu_device
        });
        if (data.has_unread_errors) setHasUnreadError(true);
      } else {
        setServerHealth({ online: false, ffmpeg: false, demucs: false, whisper: false, cuda: false, gpuDevice: '' });
      }
    } catch {
      setServerHealth({ online: false, ffmpeg: false, demucs: false, whisper: false, cuda: false, gpuDevice: '' });
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  // Inspect File Metadata
  useEffect(() => {
    if (!filePath.trim()) {
      setFileMetadata(null);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/api/file-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: filePath.trim() })
      })
        .then(res => res.ok ? res.json() : { exists: false })
        .then(data => setFileMetadata(data))
        .catch(() => setFileMetadata({ exists: false }));
    }, 400);

    return () => clearTimeout(timer);
  }, [filePath]);

  // Browse File / Folder Handlers
  const handleBrowseFile = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/pick-file`);
      const data = await res.json();
      if (data.status === 'success' && data.file_path) {
        setFilePath(data.file_path);
      }
    } catch (err) {
      console.error('File dialog error:', err);
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/pick-folder`);
      const data = await res.json();
      if (data.status === 'success' && data.folder_path) {
        setCustomOutputDir(data.folder_path);
      }
    } catch (err) {
      console.error('Folder dialog error:', err);
    }
  };

  // Open Log Modal
  const handleOpenLogModal = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs`);
      const data = await res.json();
      setLogContent(data.content || 'No log entries recorded.');
      setShowLogModal(true);
    } catch (err) {
      setLogContent(`Failed to fetch logs: ${err.message}`);
      setShowLogModal(true);
    }
  };

  const handleClearLogs = async () => {
    try {
      await fetch(`${API_BASE}/api/logs`, { method: 'DELETE' });
      setLogContent('# DEMUXER STASH ERROR LOG\n# Clear.');
      setHasUnreadError(false);
    } catch (err) {
      console.error('Clear log error:', err);
    }
  };

  const handleOpenFolder = async (folderPath) => {
    try {
      await fetch(`${API_BASE}/api/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: folderPath })
      });
    } catch (err) {
      console.error('Open folder error:', err);
    }
  };

  // Feature Handlers
  const handleSeparateAudio = () => {
    if (!filePath.trim()) return;
    setResultData(null);
    startStream(
      '/api/separate-audio',
      {
        file_path: filePath.trim(),
        model_name: modelName,
        stem_mode: stemMode,
        output_format: audioFormat,
        mp3_bitrate: mp3Bitrate,
        shifts: shiftsQuality,
        custom_output_dir: customOutputDir.trim() || undefined
      },
      `Separating Stems with ${modelName}...`,
      (data) => {
        const resObj = {
          type: 'audio',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          message: data.message,
          outputDir: data.output_directory,
          modelUsed: data.model_used,
          format: data.format,
          primaryStemPath: data.primary_stem_path,
          primaryStemUrl: data.primary_stem_url ? `${API_BASE}${data.primary_stem_url}` : null,
          bgStemPath: data.background_stem_path,
          bgStemUrl: data.background_stem_url ? `${API_BASE}${data.background_stem_url}` : null,
          command: data.command_executed
        };
        setResultData(resObj);
        saveToHistory(resObj);
      }
    );
  };

  const handleConvertVideo = () => {
    if (!filePath.trim()) return;
    setResultData(null);
    startStream(
      '/api/convert-video',
      {
        file_path: filePath.trim(),
        container: videoContainer,
        mode: videoMode,
        cq_quality: cqQuality,
        audio_codec: videoAudioCodec
      },
      videoMode === 'remux'
        ? `Remuxing Video Container (.${videoContainer.toUpperCase()})...`
        : `Converting Video for DaVinci Resolve (.${videoContainer.toUpperCase()})...`,
      (data) => {
        const resObj = {
          type: 'video',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          message: data.message,
          mode: data.mode,
          outputFile: data.output_file,
          videoUrl: data.web_url ? `${API_BASE}${data.web_url}` : null,
          command: data.command_executed
        };
        setResultData(resObj);
        saveToHistory(resObj);
      }
    );
  };

  const handleConvertAudioFormat = () => {
    if (!filePath.trim()) return;
    setResultData(null);
    startStream(
      '/api/convert-audio',
      {
        file_path: filePath.trim(),
        target_format: targetAudioFormat,
        audio_bitrate: '320k'
      },
      `Converting Audio to .${targetAudioFormat.toUpperCase()}...`,
      (data) => {
        const resObj = {
          type: 'audio_conversion',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          message: data.message,
          outputFile: data.output_file,
          webUrl: data.web_url ? `${API_BASE}${data.web_url}` : null,
          command: data.command_executed
        };
        setResultData(resObj);
        saveToHistory(resObj);
      }
    );
  };

  const handleGenerateSubtitles = () => {
    if (!filePath.trim()) return;
    setResultData(null);
    startStream(
      '/api/generate-subtitles',
      {
        file_path: filePath.trim(),
        whisper_model: whisperModel,
        language: subtitleLanguage,
        resolve_text_type: resolveTextType,
        gen_srt: genSrt,
        gen_vtt: genVtt,
        gen_txt: genTxt,
        gen_resolve_sub_xml: genResolveSubXml,
        gen_resolve_timeline_xml: genResolveTimelineXml,
        demucs_vocal_clean: demucsVocalClean
      },
      `Transcribing Speech with Whisper (${whisperModel})...`,
      (data) => {
        const resObj = {
          type: 'subtitles',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          message: data.message,
          outputDir: data.output_directory,
          srtPath: data.srt_path,
          srtUrl: data.srt_url ? `${API_BASE}${data.srt_url}` : null,
          vttPath: data.vtt_path,
          vttUrl: data.vtt_url ? `${API_BASE}${data.vtt_url}` : null,
          txtPath: data.txt_path,
          txtUrl: data.txt_url ? `${API_BASE}${data.txt_url}` : null,
          xmlPath: data.xml_path,
          xmlUrl: data.xml_url ? `${API_BASE}${data.xml_url}` : null,
          subXmlPath: data.sub_xml_path,
          subXmlUrl: data.sub_xml_url ? `${API_BASE}${data.sub_xml_url}` : null,
          resolveTextType: data.resolve_text_type,
          transcriptSummary: data.transcript_summary,
          detectedLanguage: data.detected_language
        };
        setResultData(resObj);
        saveToHistory(resObj);
      }
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-indigo-500 selection:text-white pb-16">
      {/* Background Ambient Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Navigation & Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 mb-8 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-xl shadow-indigo-500/20 text-white">
              <Disc className="w-7 h-7 animate-spin-slow" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
                Demuxer Pro AI Studio
              </h1>
              <p className="text-xs text-slate-400">High-Performance Neural Stem Separation & Media Toolkit v4.0</p>
            </div>
          </div>

          {/* Engine Status Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <div className={`px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 ${serverHealth.online ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
              <span className={`w-2 h-2 rounded-full ${serverHealth.online ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              <span>{serverHealth.online ? 'Backend Online' : 'Engine Offline'}</span>
            </div>

            {serverHealth.cuda && (
              <div className="px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 rounded-xl text-xs font-medium flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                <span>GPU: {serverHealth.gpuDevice || 'NVIDIA CUDA'}</span>
              </div>
            )}

            <button
              onClick={handleOpenLogModal}
              className={`px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition ${hasUnreadError ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'}`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Logs</span>
              {hasUnreadError && <span className="w-2 h-2 rounded-full bg-rose-500" />}
            </button>
          </div>
        </header>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-between text-rose-300 text-sm animate-fade-in">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage('')}
              className="text-xs bg-rose-500/20 hover:bg-rose-500/30 px-3 py-1 rounded-lg transition"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Media File Picker & Output Location */}
        <FilePicker
          filePath={filePath}
          setFilePath={setFilePath}
          customOutputDir={customOutputDir}
          setCustomOutputDir={setCustomOutputDir}
          fileMetadata={fileMetadata}
          onBrowseFile={handleBrowseFile}
          onBrowseFolder={handleBrowseFolder}
        />

        {/* SSE Stream Progress Bar */}
        <ProgressBar
          isProcessing={isProcessing}
          activeTask={activeTask}
          progressPercent={progressPercent}
          liveLogText={liveLogText}
          onStop={stopStream}
        />

        {/* Active Result Card */}
        <ResultCard
          resultData={resultData}
          onOpenFolder={handleOpenFolder}
        />

        {/* Synchronized Stem Mixer */}
        {resultData && resultData.type === 'audio' && (
          <StemMixer
            primaryStemUrl={resultData.primaryStemUrl}
            bgStemUrl={resultData.bgStemUrl}
            title={`Stem Mixer (${resultData.modelUsed || 'Demucs'})`}
          />
        )}

        {/* Feature Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Feature A: Audio Separation */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between backdrop-blur-xl">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
                  <Waves className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-100">AI Stem Separation (Demucs)</h3>
                  <p className="text-xs text-slate-400">Isolate vocals, drums, bass, or instrumental backing tracks</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Model Architecture</label>
                  <select
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="htdemucs_ft">htdemucs_ft (Fine-Tuned — Highest Studio Quality)</option>
                    <option value="htdemucs">htdemucs (Fast Hybrid Transformer)</option>
                    <option value="htdemucs_6s">htdemucs_6s (6-Stem: Vocals, Drums, Bass, Guitar, Piano, Other)</option>
                    <option value="mdx_extra">mdx_extra (MDX Neural Network Engine)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Isolation Target</label>
                    <select
                      value={stemMode}
                      onChange={(e) => setStemMode(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="vocals">Vocals vs Accompaniment</option>
                      <option value="drums">Drums vs Background</option>
                      <option value="bass">Bass vs Background</option>
                      <option value="all_4_stems">Full Stems (Vocals, Drums, Bass, Other)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Output Format</label>
                    <select
                      value={audioFormat}
                      onChange={(e) => setAudioFormat(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="mp3">MP3 Audio (320kbps)</option>
                      <option value="wav">WAV Audio (Lossless PCM)</option>
                      <option value="flac">FLAC Audio (Compressed Lossless)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Quality Shift Iterations</label>
                    <span className="text-xs font-mono text-indigo-400 font-bold">{shiftsQuality} {shiftsQuality === 1 ? 'Shift (Fast)' : 'Shifts (Cleaner)'}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={shiftsQuality}
                    onChange={(e) => setShiftsQuality(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleSeparateAudio}
              disabled={isProcessing || !filePath.trim() || (fileMetadata && !fileMetadata.exists)}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Waves className="w-4 h-4" />
              <span>Separate Audio Stems</span>
            </button>
          </div>

          {/* Feature B: Video Conversion */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between backdrop-blur-xl">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400">
                  <Film className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-100">DaVinci Resolve Video Encoder</h3>
                  <p className="text-xs text-slate-400">Convert videos for zero-glitch editing import (GPU NVENC + CPU)</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Processing Strategy</label>
                  <select
                    value={videoMode}
                    onChange={(e) => setVideoMode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-medium"
                  >
                    <option value="transcode">🎬 Resolve 8-bit Transcode (libx264 CRF 18) — [Recommended]</option>
                    <option value="remux">⚡ Direct Stream Copy (-c copy) — Instant (8-bit files only)</option>
                    <option value="gpu_nvenc">🚀 GPU Acceleration (NVENC H.264 8-bit)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Container Format</label>
                    <select
                      value={videoContainer}
                      onChange={(e) => setVideoContainer(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      <option value="mp4">MP4 Video (.mp4)</option>
                      <option value="mov">QuickTime (.mov)</option>
                      <option value="mkv">Matroska (.mkv)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Audio Track Codec</label>
                    <select
                      value={videoAudioCodec}
                      onChange={(e) => {
                        const val = e.target.value;
                        setVideoAudioCodec(val);
                        if (val === 'pcm' && videoContainer === 'mp4') {
                          setVideoContainer('mov');
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      <option value="aac">AAC Audio (320kbps — Universal)</option>
                      <option value="pcm">PCM Uncompressed (24-bit Studio Lossless)</option>
                    </select>
                  </div>
                </div>

                {videoMode !== 'remux' ? (
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Constant Rate Factor (CRF / CQ)</label>
                      <span className="text-xs font-mono text-purple-400 font-bold">CRF {cqQuality} ({cqQuality <= 16 ? 'Near Lossless' : cqQuality <= 19 ? 'Visually Lossless (~7GB)' : 'Compact'})</span>
                    </div>
                    <input
                      type="range"
                      min="14"
                      max="28"
                      value={cqQuality}
                      onChange={(e) => setCqQuality(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                  </div>
                ) : null}

                <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl text-[11px] text-purple-300 flex items-start gap-2">
                  <span className="text-sm leading-none">💡</span>
                  <span>
                    {videoMode === 'transcode' ? (
                      <><strong>Resolve Free Guaranteed Compatibility:</strong> Transcodes to 8-bit H.264 (<code>-pix_fmt yuv420p</code>) with visually lossless CRF 18 and 320k AAC audio. Guarantees video appears on the timeline without missing video or audio traps.</>
                    ) : videoMode === 'remux' ? (
                      videoAudioCodec === 'pcm' && videoContainer === 'mov' ? (
                        <><strong>Zero-Loss Studio Preset:</strong> Video copied 1:1 bit-for-bit into QuickTime (.mov) with 24-bit uncompressed PCM audio.</>
                      ) : (
                        <><strong>Remuxing active:</strong> Bypasses video re-encoding entirely (-c copy). Note: only works in Resolve Free if your source video is already 8-bit.</>
                      )
                    ) : (
                      <><strong>GPU NVENC active:</strong> Fast 8-bit H.264 hardware encoding using your NVIDIA GPU.</>
                    )}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleConvertVideo}
              disabled={isProcessing || !filePath.trim() || (fileMetadata && !fileMetadata.exists)}
              className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-purple-600/20 transition active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Film className="w-4 h-4" />
              <span>Convert Video for Resolve</span>
            </button>
          </div>

          {/* Feature C: Universal Audio Converter */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between backdrop-blur-xl">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
                  <Music className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-100">Universal Audio Converter</h3>
                  <p className="text-xs text-slate-400">Convert any audio format with FFmpeg progress streaming</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Target Audio Format</label>
                <select
                  value={targetAudioFormat}
                  onChange={(e) => setTargetAudioFormat(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="mp3">MP3 (Universal 320kbps)</option>
                  <option value="wav">WAV (PCM 16-bit Lossless)</option>
                  <option value="flac">FLAC (Free Lossless Codec)</option>
                  <option value="aac">AAC (Advanced Audio Coding)</option>
                  <option value="ogg">OGG (Vorbis Audio)</option>
                  <option value="m4a">M4A (Apple Audio)</option>
                  <option value="aiff">AIFF (Audio Interchange)</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleConvertAudioFormat}
              disabled={isProcessing || !filePath.trim() || (fileMetadata && !fileMetadata.exists)}
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Music className="w-4 h-4" />
              <span>Convert Audio Format</span>
            </button>
          </div>

          {/* Feature D: OpenAI Whisper Subtitles */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between backdrop-blur-xl">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-100">OpenAI Whisper AI Subtitles</h3>
                  <p className="text-xs text-slate-400">Speech-to-Text transcription with DaVinci Resolve XML export</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Whisper Model</label>
                    <select
                      value={whisperModel}
                      onChange={(e) => setWhisperModel(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-medium"
                    >
                      <option value="large-v3">Large-v3 (Maximum Studio Quality — Recommended)</option>
                      <option value="turbo">Turbo (Accelerated v3)</option>
                      <option value="medium">Medium (High Accuracy)</option>
                      <option value="small">Small (Standard Accuracy)</option>
                      <option value="base">Base (Balanced Draft)</option>
                      <option value="tiny">Tiny (Fastest / Low VRAM)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Language</label>
                    <select
                      value={subtitleLanguage}
                      onChange={(e) => setSubtitleLanguage(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="auto">Auto Detect Language</option>
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="ja">Japanese</option>
                    </select>
                  </div>
                </div>

                {/* Pre-Processing Demucs Vocal Clean Checkbox */}
                <div className="p-3 bg-slate-950/80 border border-amber-500/20 rounded-xl">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={demucsVocalClean}
                      onChange={(e) => setDemucsVocalClean(e.target.checked)}
                      className="mt-0.5 rounded accent-amber-500 shrink-0"
                    />
                    <div>
                      <span className="text-xs font-semibold text-amber-300 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        Demucs Vocal Audio Clean (Recommended for Movies / Trailers)
                      </span>
                      <p className="text-[11px] text-slate-400 leading-tight mt-0.5">
                        Isolates speech & strips 100% of background music, explosions, and sound effects before transcription for maximum accuracy.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={genSrt} onChange={(e) => setGenSrt(e.target.checked)} className="rounded accent-amber-500" />
                    <span>Generate .SRT</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={genVtt} onChange={(e) => setGenVtt(e.target.checked)} className="rounded accent-amber-500" />
                    <span>Generate .VTT</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={genTxt} onChange={(e) => setGenTxt(e.target.checked)} className="rounded accent-amber-500" />
                    <span>Generate .TXT</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={genResolveSubXml} onChange={(e) => setGenResolveSubXml(e.target.checked)} className="rounded accent-amber-500" />
                    <span>Resolve Subtitle XML</span>
                  </label>
                </div>
              </div>
            </div>

            <button
              onClick={handleGenerateSubtitles}
              disabled={isProcessing || !filePath.trim() || (fileMetadata && !fileMetadata.exists)}
              className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-600/20 transition active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText className="w-4 h-4" />
              <span>Transcribe & Generate Subtitles</span>
            </button>
          </div>
        </div>

        {/* History Drawer */}
        <HistoryList
          jobHistory={jobHistory}
          onSelectHistory={(item) => setResultData(item)}
          onClearHistory={handleClearHistory}
        />

        {/* Log Viewer Modal */}
        {showLogModal && (
          <LogModal
            logContent={logContent}
            onClose={() => setShowLogModal(false)}
            onClearLogs={handleClearLogs}
          />
        )}
      </div>
    </div>
  );
}
