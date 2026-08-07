import React, { useState, useEffect, useRef } from 'react';
import { 
  Waves, 
  Film, 
  Music, 
  FolderOpen, 
  FileCheck, 
  AlertCircle, 
  Terminal, 
  Cpu, 
  Zap, 
  RefreshCw, 
  CheckCircle2, 
  X,
  FileSearch,
  Sparkles,
  Play,
  Pause,
  Volume2,
  Sliders,
  History,
  ShieldCheck,
  Disc,
  ArrowRight,
  Trash2,
  Square,
  FileText,
  MessageSquare,
  Download,
  FileSpreadsheet,
  Copy,
  Check
} from 'lucide-react';

const API_BASE = 'http://localhost:8000';

export default function App() {
  const [filePath, setFilePath] = useState('');
  const [customOutputDir, setCustomOutputDir] = useState('');
  const [fileMetadata, setFileMetadata] = useState(null);

  // Audio Separation Options
  const [modelName, setModelName] = useState('htdemucs_ft'); // htdemucs_ft (Best), htdemucs, htdemucs_6s, mdx_extra
  const [stemMode, setStemMode] = useState('vocals'); // vocals, drums, bass, all_4_stems
  const [audioFormat, setAudioFormat] = useState('mp3'); // mp3, wav, flac
  const [mp3Bitrate, setMp3Bitrate] = useState(320);
  const [shiftsQuality, setShiftsQuality] = useState(2); // 2 shifts for cleaner background separation

  // Video Conversion Options
  const [videoContainer, setVideoContainer] = useState('mp4'); // mp4, mov, mkv
  const [cqQuality, setCqQuality] = useState(18);
  const [videoAudioCodec, setVideoAudioCodec] = useState('aac'); // aac, pcm

  // Audio Converter Options
  const [targetAudioFormat, setTargetAudioFormat] = useState('wav'); // mp3, wav, flac, aac, ogg, m4a, alac, aiff

  // Whisper Subtitles Options
  const [whisperModel, setWhisperModel] = useState('base'); // tiny, base, small
  const [subtitleLanguage, setSubtitleLanguage] = useState('auto');

  // App & Processing state
  const [serverHealth, setServerHealth] = useState({ online: false, ffmpeg: false, demucs: false, whisper: false, cuda: false, gpuDevice: '' });
  const [hasUnreadError, setHasUnreadError] = useState(false);
  
  // Real-Time SSE Progress state
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTask, setActiveTask] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [liveLogText, setLiveLogText] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);

  // Results & Alerts
  const [resultData, setResultData] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [jobHistory, setJobHistory] = useState([]);

  // Log viewer modal
  const [showLogModal, setShowLogModal] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const handleCopyLogs = () => {
    if (!logContent) return;
    navigator.clipboard.writeText(logContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Audio Player State & Refs
  const vocalsAudioRef = useRef(null);
  const bgAudioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [vocalsVolume, setVocalsVolume] = useState(1.0);
  const [bgVolume, setBgVolume] = useState(1.0);
  const [vocalsMuted, setVocalsMuted] = useState(false);
  const [bgMuted, setBgMuted] = useState(false);
  const [soloTrack, setSoloTrack] = useState(null);

  // Load History from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('demuxer_history');
      if (saved) setJobHistory(JSON.parse(saved));
    } catch (e) {
      console.error('History load error:', e);
    }
  }, []);

  const saveToHistory = (item) => {
    const updated = [item, ...jobHistory.slice(0, 9)];
    setJobHistory(updated);
    try {
      localStorage.setItem('demuxer_history', JSON.stringify(updated));
    } catch (e) {
      console.error('History save error:', e);
    }
  };

  // Check health & error status periodically
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

  // Stopwatch timer for active processing
  useEffect(() => {
    let timer;
    if (isProcessing) {
      setElapsedTime(0);
      timer = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [isProcessing]);

  // Inspect file path metadata on change
  useEffect(() => {
    if (!filePath.trim()) {
      setFileMetadata(null);
      return;
    }
    const timer = setTimeout(() => fetchFileInfo(filePath.trim()), 400);
    return () => clearTimeout(timer);
  }, [filePath]);

  const fetchFileInfo = async (pathStr) => {
    try {
      const res = await fetch(`${API_BASE}/api/file-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: pathStr })
      });
      if (res.ok) {
        const data = await res.json();
        setFileMetadata(data);
      }
    } catch {
      setFileMetadata({ exists: false });
    }
  };

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

  // STREAMED AUDIO SEPARATION WITH REAL-TIME SSE PROGRESS
  const handleSeparateAudio = async () => {
    if (!filePath.trim()) return;
    setIsProcessing(true);
    setProgressPercent(2);
    setActiveTask(`Separating Stems with ${modelName} (Quality Boost)...`);
    setLiveLogText('Initializing Demucs neural separation engine...');
    setErrorMessage('');
    setResultData(null);
    setIsPlaying(false);

    try {
      const response = await fetch(`${API_BASE}/api/separate-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          file_path: filePath.trim(),
          model_name: modelName,
          stem_mode: stemMode,
          output_format: audioFormat,
          mp3_bitrate: mp3Bitrate,
          shifts: shiftsQuality,
          custom_output_dir: customOutputDir.trim() || undefined
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.replace('data: ', ''));
              if (eventData.type === 'progress') {
                if (eventData.percent !== undefined) setProgressPercent(eventData.percent);
                if (eventData.text) setLiveLogText(eventData.text);
              } else if (eventData.type === 'complete') {
                setProgressPercent(100);
                const data = eventData.result;
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
              } else if (eventData.type === 'error') {
                setHasUnreadError(true);
                setErrorMessage(eventData.message || 'Processing Failed. Check stash_error_log.txt for details.');
              }
            } catch (e) {
              console.log('SSE parse error:', e);
            }
          }
        }
      }
    } catch (err) {
      setHasUnreadError(true);
      setErrorMessage('Processing Failed. Check stash_error_log.txt for details.');
    } finally {
      setIsProcessing(false);
    }
  };

  // STREAMED VIDEO CONVERSION WITH REAL-TIME SSE PROGRESS
  const handleConvertVideo = async () => {
    if (!filePath.trim()) return;
    setIsProcessing(true);
    setProgressPercent(5);
    setActiveTask(`Converting Video for Resolve (.${videoContainer.toUpperCase()})...`);
    setLiveLogText('Starting FFmpeg GPU/CPU encoding pipeline...');
    setErrorMessage('');
    setResultData(null);

    try {
      const response = await fetch(`${API_BASE}/api/convert-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          file_path: filePath.trim(),
          container: videoContainer,
          cq_quality: cqQuality,
          audio_codec: videoAudioCodec
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.replace('data: ', ''));
              if (eventData.type === 'progress') {
                if (eventData.percent !== undefined) setProgressPercent(eventData.percent);
                if (eventData.text) setLiveLogText(eventData.text);
              } else if (eventData.type === 'complete') {
                setProgressPercent(100);
                const data = eventData.result;
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
              } else if (eventData.type === 'error') {
                setHasUnreadError(true);
                setErrorMessage(eventData.message || 'Processing Failed. Check stash_error_log.txt for details.');
              }
            } catch (e) {
              console.log('SSE parse error:', e);
            }
          }
        }
      }
    } catch (err) {
      setHasUnreadError(true);
      setErrorMessage('Processing Failed. Check stash_error_log.txt for details.');
    } finally {
      setIsProcessing(false);
    }
  };

  // AUDIO FORMAT CONVERTER
  const handleConvertAudioFormat = async () => {
    if (!filePath.trim()) return;
    setIsProcessing(true);
    setProgressPercent(30);
    setActiveTask(`Converting Audio Format to .${targetAudioFormat.toUpperCase()}...`);
    setErrorMessage('');
    setResultData(null);

    try {
      const res = await fetch(`${API_BASE}/api/convert-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          file_path: filePath.trim(),
          target_format: targetAudioFormat,
          audio_bitrate: '320k'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setHasUnreadError(true);
        setErrorMessage(data.detail || 'Processing Failed. Check stash_error_log.txt for details.');
      } else {
        setProgressPercent(100);
        const resObj = {
          type: 'audio_conversion',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          message: data.message,
          outputFile: data.output_file,
          command: data.command_executed
        };
        setResultData(resObj);
        saveToHistory(resObj);
      }
    } catch (err) {
      setHasUnreadError(true);
      setErrorMessage('Processing Failed. Check stash_error_log.txt for details.');
    } finally {
      setIsProcessing(false);
    }
  };

  // WHISPER SUBTITLES & DAVINCI RESOLVE XML GENERATOR
  const handleGenerateSubtitles = async () => {
    if (!filePath.trim()) return;
    setIsProcessing(true);
    setProgressPercent(15);
    setActiveTask(`Transcribing Speech with Whisper AI (${whisperModel})...`);
    setLiveLogText('Running local Whisper AI model on GPU...');
    setErrorMessage('');
    setResultData(null);

    try {
      const res = await fetch(`${API_BASE}/api/generate-subtitles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          file_path: filePath.trim(),
          whisper_model: whisperModel,
          language: subtitleLanguage
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setHasUnreadError(true);
        setErrorMessage(data.detail || 'Subtitle generation failed. Check stash_error_log.txt for details.');
      } else {
        setProgressPercent(100);
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
          transcriptSummary: data.transcript_summary,
          detectedLanguage: data.detected_language
        };
        setResultData(resObj);
        saveToHistory(resObj);
      }
    } catch (err) {
      setHasUnreadError(true);
      setErrorMessage('Subtitle generation failed. Check stash_error_log.txt for details.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearLogs = async () => {
    try {
      await fetch(`${API_BASE}/api/logs`, { method: 'DELETE' });
      setLogContent('# DEMUXER STASH ERROR LOG\n# Log file cleared.');
      setHasUnreadError(false);
    } catch (err) {
      console.error('Error clearing logs:', err);
    }
  };

  const handleStopProcess = async () => {
    try {
      await fetch(`${API_BASE}/api/stop-process`, { method: 'POST' });
      setIsProcessing(false);
      setLiveLogText('Process terminated by user.');
    } catch (err) {
      console.error('Error stopping process:', err);
    }
  };

  // Audio Playback Transport
  const togglePlayAudio = () => {
    if (!vocalsAudioRef.current && !bgAudioRef.current) return;
    if (isPlaying) {
      if (vocalsAudioRef.current) vocalsAudioRef.current.pause();
      if (bgAudioRef.current) bgAudioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (vocalsAudioRef.current) vocalsAudioRef.current.play().catch(e => console.log(e));
      if (bgAudioRef.current) bgAudioRef.current.play().catch(e => console.log(e));
      setIsPlaying(true);
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (vocalsAudioRef.current) vocalsAudioRef.current.currentTime = time;
    if (bgAudioRef.current) bgAudioRef.current.currentTime = time;
  };

  // Solo / Mute logic
  const effectiveVocalsVol = soloTrack === 'bg' ? 0 : (vocalsMuted ? 0 : vocalsVolume);
  const effectiveBgVol = soloTrack === 'vocals' ? 0 : (bgMuted ? 0 : bgVolume);

  useEffect(() => {
    if (vocalsAudioRef.current) vocalsAudioRef.current.volume = effectiveVocalsVol;
  }, [effectiveVocalsVol]);

  useEffect(() => {
    if (bgAudioRef.current) bgAudioRef.current.volume = effectiveBgVol;
  }, [effectiveBgVol]);

  const openLogViewer = async () => {
    setHasUnreadError(false); // Reset error notification badge on click
    try {
      const res = await fetch(`${API_BASE}/api/logs?t=${Date.now()}`);
      const data = await res.json();
      setLogContent(data.content || 'No log data');
      setShowLogModal(true);
    } catch (err) {
      setLogContent('Failed to load stash_error_log.txt');
      setShowLogModal(true);
    }
  };

  const openFolder = async (pathStr) => {
    if (!pathStr) return;
    try {
      await fetch(`${API_BASE}/api/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: pathStr })
      });
    } catch (err) {
      console.error('Error opening folder:', err);
    }
  };

  const formatSeconds = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      
      {/* HEADER BAR */}
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '2rem',
        paddingBottom: '1.25rem',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{
            background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
            padding: '0.75rem',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            boxShadow: '0 0 24px rgba(139, 92, 246, 0.35)'
          }}>
            <Waves size={28} color="white" />
          </div>
          <div>
            <h1 style={{ 
              fontSize: '1.8rem', 
              fontWeight: 800, 
              letterSpacing: '-0.02em',
              background: 'linear-gradient(to right, #ffffff, #9ca3af)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              DEMUXER <span style={{ fontSize: '0.9rem', color: 'var(--accent-purple)', fontWeight: 700 }}>PRO v4</span>
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              AI Stem Isolation • Whisper Subtitles • DaVinci Resolve Suite
            </p>
          </div>
        </div>

        {/* Status & Stash Logs Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="glass-card" style={{ padding: '0.45rem 0.9rem', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
            <span style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: serverHealth.online ? 'var(--accent-emerald)' : 'var(--accent-rose)',
              boxShadow: serverHealth.online ? '0 0 8px var(--accent-emerald)' : '0 0 8px var(--accent-rose)'
            }} />
            <span style={{ fontWeight: 600, color: serverHealth.online ? 'var(--text-main)' : 'var(--text-muted)' }}>
              Engine {serverHealth.online ? 'Online' : 'Offline'}
            </span>
          </div>

          {serverHealth.cuda && (
            <div className="glass-card" style={{ padding: '0.45rem 0.9rem', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
              <Zap size={14} color="var(--accent-cyan)" />
              <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>
                {serverHealth.gpuDevice || 'NVIDIA GPU'}
              </span>
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <button 
              onClick={openLogViewer}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem', borderRadius: '30px' }}
            >
              <Terminal size={14} />
              <span>Stash Logs</span>
            </button>

            {hasUnreadError && (
              <span style={{
                position: 'absolute',
                top: '-3px',
                right: '-3px',
                width: '12px',
                height: '12px',
                backgroundColor: 'var(--accent-rose)',
                borderRadius: '50%',
                boxShadow: '0 0 10px var(--accent-rose)',
                border: '2px solid var(--bg-dark)',
                animation: 'pulseGlow 1.5s infinite'
              }} />
            )}
          </div>
        </div>
      </header>

      {/* INPUT MEDIA FILE SELECTOR */}
      <section className="glass-card" style={{ padding: '1.75rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FileSearch size={20} color="var(--accent-purple)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Target Audio or Video File</h2>
          </div>
          {fileMetadata && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              {fileMetadata.exists ? (
                <span style={{ 
                  background: 'rgba(16, 185, 129, 0.15)', 
                  color: 'var(--accent-emerald)', 
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '0.2rem 0.65rem', 
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}>
                  <FileCheck size={12} /> {fileMetadata.extension.toUpperCase()} • {fileMetadata.size_mb} MB
                </span>
              ) : (
                <span style={{ 
                  background: 'rgba(244, 63, 94, 0.15)', 
                  color: 'var(--accent-rose)', 
                  border: '1px solid rgba(244, 63, 94, 0.3)',
                  padding: '0.2rem 0.65rem', 
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 600
                }}>
                  File Not Found
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
          <input 
            type="text" 
            className="glass-input" 
            placeholder='Paste file path or click Browse (Supports MP3, WAV, FLAC, M4A, AAC, MP4, MKV, MOV, etc.)'
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
          />
          <button 
            onClick={handleBrowseFile}
            className="btn btn-secondary"
            style={{ whiteSpace: 'nowrap' }}
          >
            <FolderOpen size={16} />
            <span>Browse...</span>
          </button>
        </div>

        {/* Custom Output Directory Row */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Output Directory:</span>
          <input 
            type="text" 
            className="glass-input" 
            style={{ fontSize: '0.82rem', padding: '0.5rem 0.85rem' }}
            placeholder="Default: \separated, \subtitles, \converted, and \converted_audio"
            value={customOutputDir}
            onChange={(e) => setCustomOutputDir(e.target.value)}
          />
          <button 
            onClick={handleBrowseFolder}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.5rem 0.9rem', whiteSpace: 'nowrap' }}
          >
            <FolderOpen size={14} />
            <span>Set Folder</span>
          </button>
        </div>
      </section>

      {/* FEATURE CARDS GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* FEATURE A: DEMUCS AI STEM SEPARATION */}
        <div className="glass-card" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
              <div style={{ 
                width: '44px', 
                height: '44px', 
                borderRadius: '12px', 
                background: 'rgba(139, 92, 246, 0.15)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center'
              }}>
                <Music size={24} color="var(--accent-purple)" />
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-purple)', background: 'var(--accent-purple-glow)', padding: '0.25rem 0.6rem', borderRadius: '12px' }}>
                AI STEM ISOLATION
              </span>
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.4rem' }}>
              AI Stem Isolation
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '1.25rem' }}>
              Extract pristine **Vocals** and **Background Instrumental** with zero artifacts.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.5rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                  AI Neural Model:
                </label>
                <select 
                  className="glass-input"
                  style={{ cursor: 'pointer' }}
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                >
                  <option value="htdemucs_ft">✨ htdemucs_ft (Fine-Tuned - Highest Quality & Cleanest Background)</option>
                  <option value="htdemucs">⚡ htdemucs (Standard Fast)</option>
                  <option value="htdemucs_6s">🎹 htdemucs_6s (6-Stems: Vocals, Drums, Bass, Other, Piano, Guitar)</option>
                  <option value="mdx_extra">🎛️ mdx_extra (MDX Architecture)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Separation Target:
                  </label>
                  <select 
                    className="glass-input"
                    style={{ cursor: 'pointer' }}
                    value={stemMode}
                    onChange={(e) => setStemMode(e.target.value)}
                  >
                    <option value="vocals">🎤 Vocals + Background</option>
                    <option value="drums">🥁 Drums + Accompaniment</option>
                    <option value="bass">🎸 Bass + Accompaniment</option>
                    <option value="all_4_stems">🎹 Full Band (4 Stems)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Quality Shifts Boost:
                  </label>
                  <select 
                    className="glass-input"
                    style={{ cursor: 'pointer' }}
                    value={shiftsQuality}
                    onChange={(e) => setShiftsQuality(Number(e.target.value))}
                  >
                    <option value={2}>2 Shifts (Clean Background)</option>
                    <option value={1}>1 Shift (Fastest)</option>
                    <option value={4}>4 Shifts (Ultra Clean)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Stem Format:
                  </label>
                  <select 
                    className="glass-input"
                    style={{ cursor: 'pointer' }}
                    value={audioFormat}
                    onChange={(e) => setAudioFormat(e.target.value)}
                  >
                    <option value="mp3">MP3 (Compressed)</option>
                    <option value="wav">WAV (Lossless 16-bit)</option>
                    <option value="flac">FLAC (Lossless Compressed)</option>
                  </select>
                </div>

                {audioFormat === 'mp3' && (
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                      MP3 Bitrate:
                    </label>
                    <select 
                      className="glass-input"
                      style={{ cursor: 'pointer' }}
                      value={mp3Bitrate}
                      onChange={(e) => setMp3Bitrate(Number(e.target.value))}
                    >
                      <option value={320}>320 kbps (High)</option>
                      <option value={256}>256 kbps</option>
                      <option value={192}>192 kbps</option>
                    </select>
                  </div>
                )}
              </div>

            </div>
          </div>

          <button 
            className="btn btn-purple" 
            style={{ width: '100%' }}
            disabled={!filePath.trim() || isProcessing || (fileMetadata && !fileMetadata.exists)}
            onClick={handleSeparateAudio}
          >
            <Sparkles size={18} />
            <span>Isolate Stems ({audioFormat.toUpperCase()})</span>
          </button>
        </div>

        {/* FEATURE B: LOCAL WHISPER SUBTITLES & RESOLVE XML (NEW!) */}
        <div className="glass-card" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
              <div style={{ 
                width: '44px', 
                height: '44px', 
                borderRadius: '12px', 
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center'
              }}>
                <FileText size={24} color="var(--accent-amber)" />
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-amber)', background: 'rgba(245, 158, 11, 0.2)', padding: '0.25rem 0.6rem', borderRadius: '12px' }}>
                WHISPER AI • 100% FREE
              </span>
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.4rem' }}>
              Whisper Subtitles & XML
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '1.25rem' }}>
              Generate **`.SRT`**, **`.VTT`**, **`.TXT`**, and **DaVinci Resolve `.XML`** timeline files locally on GPU.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Whisper AI Model:
                  </label>
                  <select 
                    className="glass-input"
                    style={{ cursor: 'pointer' }}
                    value={whisperModel}
                    onChange={(e) => setWhisperModel(e.target.value)}
                  >
                    <option value="base">Whisper Base (Fast & Accurate)</option>
                    <option value="small">Whisper Small (High Precision)</option>
                    <option value="tiny">Whisper Tiny (Ultra-Fast)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Language:
                  </label>
                  <select 
                    className="glass-input"
                    style={{ cursor: 'pointer' }}
                    value={subtitleLanguage}
                    onChange={(e) => setSubtitleLanguage(e.target.value)}
                  >
                    <option value="auto">Auto-Detect</option>
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="hi">Hindi</option>
                    <option value="ja">Japanese</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <button 
            className="btn btn-secondary" 
            style={{ width: '100%', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'white', border: 'none' }}
            disabled={!filePath.trim() || isProcessing || (fileMetadata && !fileMetadata.exists)}
            onClick={handleGenerateSubtitles}
          >
            <FileText size={18} />
            <span>Generate Subtitles & Resolve XML</span>
          </button>
        </div>

        {/* FEATURE C: UNIVERSAL AUDIO CONVERTER */}
        <div className="glass-card" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
              <div style={{ 
                width: '44px', 
                height: '44px', 
                borderRadius: '12px', 
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center'
              }}>
                <Disc size={24} color="var(--accent-emerald)" />
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-emerald)', background: 'var(--accent-emerald-glow)', padding: '0.25rem 0.6rem', borderRadius: '12px' }}>
                AUDIO CONVERTER
              </span>
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.4rem' }}>
              Universal Audio Converter
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '1.25rem' }}>
              Convert any audio or video file into your choice of audio format.
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                Target Audio Format:
              </label>
              <select 
                className="glass-input"
                style={{ cursor: 'pointer' }}
                value={targetAudioFormat}
                onChange={(e) => setTargetAudioFormat(e.target.value)}
              >
                <option value="wav">WAV (Uncompressed PCM - Best Quality)</option>
                <option value="mp3">MP3 320 kbps (Universal)</option>
                <option value="flac">FLAC (Lossless Compressed)</option>
                <option value="aac">AAC 320 kbps</option>
                <option value="m4a">M4A (Apple Audio)</option>
                <option value="ogg">OGG Vorbis</option>
                <option value="aiff">AIFF (Pro Studio)</option>
              </select>
            </div>
          </div>

          <button 
            className="btn btn-cyan" 
            style={{ width: '100%', background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)' }}
            disabled={!filePath.trim() || isProcessing || (fileMetadata && !fileMetadata.exists)}
            onClick={handleConvertAudioFormat}
          >
            <Disc size={18} />
            <span>Convert Audio to .{targetAudioFormat.toUpperCase()}</span>
          </button>
        </div>

        {/* FEATURE D: DAVINCI RESOLVE CONVERTER */}
        <div className="glass-card" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
              <div style={{ 
                width: '44px', 
                height: '44px', 
                borderRadius: '12px', 
                background: 'rgba(6, 182, 212, 0.15)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center'
              }}>
                <Film size={24} color="var(--accent-cyan)" />
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-cyan)', background: 'var(--accent-cyan-glow)', padding: '0.25rem 0.6rem', borderRadius: '12px' }}>
                FFMPEG RESOLVE
              </span>
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.4rem' }}>
              Resolve Video Converter
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '1.25rem' }}>
              Lossless DaVinci Resolve format with GPU acceleration and CPU fallback.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Container:
                  </label>
                  <select 
                    className="glass-input"
                    style={{ cursor: 'pointer' }}
                    value={videoContainer}
                    onChange={(e) => setVideoContainer(e.target.value)}
                  >
                    <option value="mp4">.MP4 (Standard)</option>
                    <option value="mov">.MOV (QuickTime)</option>
                    <option value="mkv">.MKV (Matroska)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Quality:
                  </label>
                  <select 
                    className="glass-input"
                    style={{ cursor: 'pointer' }}
                    value={cqQuality}
                    onChange={(e) => setCqQuality(Number(e.target.value))}
                  >
                    <option value={18}>CRF 18 (Lossless)</option>
                    <option value={14}>CRF 14 (Max)</option>
                    <option value={22}>CRF 22 (Balanced)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                  Resolve Audio Track Codec:
                </label>
                <select 
                  className="glass-input"
                  style={{ cursor: 'pointer' }}
                  value={videoAudioCodec}
                  onChange={(e) => setVideoAudioCodec(e.target.value)}
                >
                  <option value="aac">AAC 320 kbps (High Quality)</option>
                  <option value="pcm">PCM 16-bit Uncompressed WAV (Resolve Native)</option>
                </select>
              </div>
            </div>
          </div>

          <button 
            className="btn btn-cyan" 
            style={{ width: '100%' }}
            disabled={!filePath.trim() || isProcessing || (fileMetadata && !fileMetadata.exists)}
            onClick={handleConvertVideo}
          >
            <Film size={18} />
            <span>Convert for Resolve (.{videoContainer.toUpperCase()})</span>
          </button>
        </div>

      </div>

      {/* REAL-TIME STREAMING PROGRESS BAR OVERLAY */}
      {isProcessing && (
        <section className="glass-card" style={{ 
          padding: '2.25rem', 
          marginBottom: '2rem',
          border: '1px solid var(--border-highlight)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <RefreshCw size={22} color="var(--accent-purple)" className="animate-spin" />
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{activeTask}</h3>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button 
                onClick={handleStopProcess}
                className="btn btn-outline-danger"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
              >
                <Square size={13} style={{ fill: 'currentColor' }} />
                <span>Stop Process</span>
              </button>

              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-purple)' }}>
                {progressPercent}%
              </span>
            </div>
          </div>

          {/* Glowing Animated Progress Bar */}
          <div style={{
            width: '100%',
            height: '14px',
            backgroundColor: 'rgba(0,0,0,0.5)',
            borderRadius: '10px',
            overflow: 'hidden',
            marginBottom: '1rem',
            border: '1px solid rgba(255,255,255,0.08)',
            position: 'relative'
          }}>
            <div style={{
              width: `${Math.max(5, progressPercent)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #8b5cf6 0%, #06b6d4 100%)',
              borderRadius: '10px',
              transition: 'width 0.3s ease',
              boxShadow: '0 0 15px rgba(139, 92, 246, 0.6)'
            }} />
          </div>

          {/* Clean Progress Status Phrasing */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <span style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>
              {liveLogText || 'Processing media...'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)', fontWeight: 600 }}>
              Elapsed: {formatSeconds(elapsedTime)}
            </span>
          </div>
        </section>
      )}

      {/* ERROR ALERT NOTIFICATION */}
      {errorMessage && (
        <section className="glass-card" style={{ 
          padding: '1.5rem', 
          marginBottom: '2rem', 
          background: 'rgba(244, 63, 94, 0.1)', 
          border: '1px solid rgba(244, 63, 94, 0.35)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '0.85rem' }}>
              <AlertCircle size={24} color="var(--accent-rose)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <h4 style={{ color: 'var(--accent-rose)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.3rem' }}>
                  Execution Failed
                </h4>
                <p style={{ color: 'var(--text-main)', fontSize: '0.9rem', marginBottom: '0.8rem' }}>
                  {errorMessage}
                </p>
                <button 
                  onClick={openLogViewer}
                  className="btn btn-outline-danger"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
                >
                  <Terminal size={14} />
                  <span>Inspect stash_error_log.txt</span>
                </button>
              </div>
            </div>
            <button 
              onClick={() => setErrorMessage('')} 
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>
        </section>
      )}

      {/* SUBTITLES RESULT CARD */}
      {resultData && resultData.type === 'subtitles' && (
        <section className="glass-card" style={{ 
          padding: '1.75rem', 
          marginBottom: '2rem',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.3)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <CheckCircle2 size={24} color="var(--accent-amber)" />
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--accent-amber)' }}>
                  Whisper Subtitles & Resolve XML Generated!
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Language: <strong style={{ color: 'var(--text-main)' }}>{resultData.detectedLanguage?.toUpperCase()}</strong> • 100% Free & Local
                </p>
              </div>
            </div>

            <button 
              onClick={() => openFolder(resultData.outputDir)}
              className="btn btn-secondary"
              style={{ fontSize: '0.85rem' }}
            >
              <FolderOpen size={16} />
              <span>Open Output Folder</span>
            </button>
          </div>

          {/* Action Download Buttons Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {resultData.srtPath && (
              <button onClick={() => openFolder(resultData.srtPath)} className="btn btn-secondary" style={{ fontSize: '0.8rem', justifyContent: 'flex-start' }}>
                <FileText size={16} color="var(--accent-amber)" />
                <span>Open .SRT Subtitles</span>
              </button>
            )}
            {resultData.vttPath && (
              <button onClick={() => openFolder(resultData.vttPath)} className="btn btn-secondary" style={{ fontSize: '0.8rem', justifyContent: 'flex-start' }}>
                <MessageSquare size={16} color="var(--accent-cyan)" />
                <span>Open .VTT Web Subtitles</span>
              </button>
            )}
            {resultData.xmlPath && (
              <button onClick={() => openFolder(resultData.xmlPath)} className="btn btn-secondary" style={{ fontSize: '0.8rem', justifyContent: 'flex-start' }}>
                <FileSpreadsheet size={16} color="var(--accent-purple)" />
                <span>Open Resolve .XML Timeline</span>
              </button>
            )}
          </div>

          {/* Live Transcript Preview Box */}
          {resultData.transcriptSummary && (
            <div style={{ 
              background: 'rgba(0,0,0,0.4)', 
              padding: '1rem', 
              borderRadius: '10px', 
              fontSize: '0.85rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-main)',
              maxHeight: '160px',
              overflowY: 'auto',
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--accent-amber)', marginBottom: '0.4rem', fontWeight: 600 }}>
                TRANSCRIPT PREVIEW:
              </p>
              <pre style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                {resultData.transcriptSummary}
              </pre>
            </div>
          )}
        </section>
      )}

      {/* DUAL STEM AUDIO MIXER & PLAYER */}
      {resultData && resultData.type === 'audio' && (resultData.primaryStemUrl || resultData.bgStemUrl) && (
        <section className="glass-card" style={{ padding: '1.75rem', marginBottom: '2rem', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Sliders size={22} color="var(--accent-purple)" />
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Synchronized Stem Audio Mixer</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Model: <span style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>{resultData.modelUsed || 'htdemucs_ft'}</span>
                </p>
              </div>
            </div>

            <button 
              onClick={() => openFolder(resultData.outputDir)}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
            >
              <FolderOpen size={14} /> Open Output Folder
            </button>
          </div>

          {/* Hidden HTML5 Audio elements */}
          {resultData.primaryStemUrl && (
            <audio 
              ref={vocalsAudioRef} 
              src={resultData.primaryStemUrl} 
              onTimeUpdate={() => {
                if (vocalsAudioRef.current) {
                  setCurrentTime(vocalsAudioRef.current.currentTime);
                  setDuration(vocalsAudioRef.current.duration || 0);
                }
              }}
              onEnded={() => setIsPlaying(false)}
            />
          )}
          {resultData.bgStemUrl && (
            <audio ref={bgAudioRef} src={resultData.bgStemUrl} />
          )}

          {/* Master Transport Controls */}
          <div style={{ 
            background: 'rgba(0,0,0,0.4)', 
            padding: '1.2rem', 
            borderRadius: '14px', 
            marginBottom: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button 
                onClick={togglePlayAudio}
                className="btn btn-purple"
                style={{ borderRadius: '50%', width: '48px', height: '48px', padding: 0 }}
              >
                {isPlaying ? <Pause size={22} /> : <Play size={22} style={{ marginLeft: '3px' }} />}
              </button>

              <div style={{ flexGrow: 1 }}>
                <input 
                  type="range"
                  min="0"
                  max={duration || 100}
                  step="0.1"
                  value={currentTime}
                  onChange={handleSeek}
                  style={{ width: '100%', accentColor: 'var(--accent-purple)', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '0.3rem' }}>
                  <span>{formatSeconds(currentTime)}</span>
                  <span>{formatSeconds(duration)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Stem Faders Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            
            {/* VOCALS STEM FADER */}
            <div style={{ background: 'rgba(0,0,0,0.25)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-purple)' }}>🎤 Vocals Stem</span>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button 
                    onClick={() => setSoloTrack(soloTrack === 'vocals' ? null : 'vocals')}
                    style={{
                      background: soloTrack === 'vocals' ? 'var(--accent-purple)' : 'rgba(255,255,255,0.1)',
                      color: soloTrack === 'vocals' ? 'white' : 'var(--text-muted)',
                      border: 'none', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    SOLO
                  </button>
                  <button 
                    onClick={() => setVocalsMuted(!vocalsMuted)}
                    style={{
                      background: vocalsMuted ? 'var(--accent-rose)' : 'rgba(255,255,255,0.1)',
                      color: vocalsMuted ? 'white' : 'var(--text-muted)',
                      border: 'none', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    MUTE
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Volume2 size={16} color="var(--text-muted)" />
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={vocalsVolume} 
                  onChange={(e) => setVocalsVolume(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-purple)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', minWidth: '35px' }}>
                  {Math.round(vocalsVolume * 100)}%
                </span>
              </div>
            </div>

            {/* BACKGROUND / INSTRUMENTAL STEM FADER */}
            <div style={{ background: 'rgba(0,0,0,0.25)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>🎸 Background Instrumental Stem</span>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button 
                    onClick={() => setSoloTrack(soloTrack === 'bg' ? null : 'bg')}
                    style={{
                      background: soloTrack === 'bg' ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.1)',
                      color: soloTrack === 'bg' ? 'white' : 'var(--text-muted)',
                      border: 'none', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    SOLO
                  </button>
                  <button 
                    onClick={() => setBgMuted(!bgMuted)}
                    style={{
                      background: bgMuted ? 'var(--accent-rose)' : 'rgba(255,255,255,0.1)',
                      color: bgMuted ? 'white' : 'var(--text-muted)',
                      border: 'none', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    MUTE
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Volume2 size={16} color="var(--text-muted)" />
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={bgVolume} 
                  onChange={(e) => setBgVolume(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-cyan)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', minWidth: '35px' }}>
                  {Math.round(bgVolume * 100)}%
                </span>
              </div>
            </div>

          </div>
        </section>
      )}

      {/* OTHER RESULT CARD */}
      {resultData && resultData.type !== 'audio' && resultData.type !== 'subtitles' && (
        <section className="glass-card" style={{ 
          padding: '1.75rem', 
          marginBottom: '2rem',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.3)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <CheckCircle2 size={24} color="var(--accent-emerald)" />
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--accent-emerald)' }}>
                  Processing Completed!
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {resultData.message}
                </p>
              </div>
            </div>

            <button 
              onClick={() => openFolder(resultData.outputFile)}
              className="btn btn-secondary"
              style={{ fontSize: '0.85rem' }}
            >
              <FolderOpen size={16} />
              <span>Open Output Folder</span>
            </button>
          </div>

          <div style={{ 
            background: 'rgba(0,0,0,0.3)', 
            padding: '1rem', 
            borderRadius: '10px', 
            fontSize: '0.85rem',
            fontFamily: 'var(--font-mono)',
            border: '1px solid rgba(255,255,255,0.06)'
          }}>
            <p style={{ color: 'var(--accent-emerald)', marginBottom: '0.4rem', fontWeight: 600 }}>
              Output File Location:
            </p>
            <p style={{ color: 'var(--text-main)', wordBreak: 'break-all' }}>
              {resultData.outputFile}
            </p>
          </div>
        </section>
      )}

      {/* RECENT JOBS HISTORY */}
      {jobHistory.length > 0 && (
        <section className="glass-card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <History size={18} color="var(--text-muted)" />
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)' }}>Recent Jobs History</h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {jobHistory.map((item, idx) => (
              <div key={idx} style={{ 
                background: 'rgba(0,0,0,0.25)', 
                padding: '0.75rem 1rem', 
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.82rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  {item.type === 'audio' ? <Music size={16} color="var(--accent-purple)" /> : item.type === 'subtitles' ? <FileText size={16} color="var(--accent-amber)" /> : item.type === 'audio_conversion' ? <Disc size={16} color="var(--accent-emerald)" /> : <Film size={16} color="var(--accent-cyan)" />}
                  <span style={{ fontWeight: 600 }}>
                    {item.type === 'audio' ? `Stems (${item.modelUsed || 'Demucs'})` : item.type === 'subtitles' ? 'Whisper Subtitles' : item.type === 'audio_conversion' ? 'Audio Conversion' : 'Resolve Video'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({item.timestamp})</span>
                </div>
                <button 
                  onClick={() => openFolder(item.outputDir || item.outputFile)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-purple)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem' }}
                >
                  <FolderOpen size={13} /> Open
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* RAW STASH LOG VIEWER MODAL */}
      {showLogModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1.5rem'
        }}>
          <div className="glass-card" style={{
            width: '100%',
            maxWidth: '850px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Terminal size={20} color="var(--accent-rose)" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>stash_error_log.txt Viewer</h3>
              </div>
              <button 
                onClick={() => setShowLogModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{
              padding: '1.25rem',
              overflowY: 'auto',
              flexGrow: 1,
              background: '#07080c'
            }}>
              <pre style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem',
                color: '#e5e7eb',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                lineHeight: '1.6'
              }}>
                {logContent}
              </pre>
            </div>

            <div style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid var(--border-top)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <button 
                  onClick={handleClearLogs}
                  className="btn btn-outline-danger" 
                  style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem' }}
                >
                  <Trash2 size={14} /> Clear Logs
                </button>
                <button 
                  onClick={handleCopyLogs}
                  className="btn btn-secondary" 
                  style={{ 
                    fontSize: '0.85rem', 
                    padding: '0.45rem 0.85rem',
                    color: isCopied ? 'var(--accent-emerald)' : 'inherit',
                    borderColor: isCopied ? 'var(--accent-emerald)' : undefined
                  }}
                >
                  {isCopied ? <Check size={14} color="var(--accent-emerald)" /> : <Copy size={14} />}
                  <span>{isCopied ? 'Copied!' : 'Copy Logs'}</span>
                </button>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button 
                  onClick={openLogViewer} 
                  className="btn btn-secondary" 
                  style={{ fontSize: '0.85rem' }}
                >
                  <RefreshCw size={14} /> Refresh Logs
                </button>
                <button 
                  onClick={() => setShowLogModal(false)} 
                  className="btn btn-purple" 
                  style={{ fontSize: '0.85rem' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
