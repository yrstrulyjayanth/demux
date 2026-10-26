import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, Sliders, Music, Download } from 'lucide-react';

export default function StemMixer({ primaryStemUrl, bgStemUrl, title = 'Stem Mixer' }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Audio track controls
  const [volPrimary, setVolPrimary] = useState(1.0);
  const [volBg, setVolBg] = useState(1.0);
  const [mutePrimary, setMutePrimary] = useState(false);
  const [muteBg, setMuteBg] = useState(false);
  const [soloTrack, setSoloTrack] = useState(null); // 'primary' | 'bg' | null

  // Web Audio API refs
  const audioCtxRef = useRef(null);
  const bufferPrimaryRef = useRef(null);
  const bufferBgRef = useRef(null);
  
  const sourcePrimaryRef = useRef(null);
  const sourceBgRef = useRef(null);

  const gainPrimaryRef = useRef(null);
  const gainBgRef = useRef(null);

  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const animFrameRef = useRef(null);

  // Initialize Web Audio Context & Fetch Audio Buffers safely
  useEffect(() => {
    if (!primaryStemUrl) return;

    let isMounted = true;
    setIsLoading(true);
    setLoadError('');

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;

    const gainP = ctx.createGain();
    const gainB = ctx.createGain();
    gainP.connect(ctx.destination);
    gainB.connect(ctx.destination);

    gainPrimaryRef.current = gainP;
    gainBgRef.current = gainB;

    const loadBuffers = async () => {
      try {
        const fetchP = fetch(primaryStemUrl).then(res => res.arrayBuffer()).then(buf => ctx.decodeAudioData(buf));
        const fetchB = bgStemUrl ? fetch(bgStemUrl).then(res => res.arrayBuffer()).then(buf => ctx.decodeAudioData(buf)) : Promise.resolve(null);

        const [bufP, bufB] = await Promise.all([fetchP, fetchB]);

        if (isMounted) {
          bufferPrimaryRef.current = bufP;
          bufferBgRef.current = bufB;
          const maxDur = Math.max(bufP ? bufP.duration : 0, bufB ? bufB.duration : 0);
          setDuration(maxDur);
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.error('Web Audio load error:', err);
          setLoadError('Failed to load Web Audio buffers.');
          setIsLoading(false);
        }
      }
    };

    loadBuffers();

    return () => {
      isMounted = false;
      stopSources();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
    };
  }, [primaryStemUrl, bgStemUrl]);

  // Update volume and mute settings on gain nodes
  useEffect(() => {
    if (!gainPrimaryRef.current || !gainBgRef.current) return;

    let effPrimary = volPrimary;
    let effBg = volBg;

    if (mutePrimary) effPrimary = 0;
    if (muteBg) effBg = 0;

    if (soloTrack === 'primary') {
      effBg = 0;
    } else if (soloTrack === 'bg') {
      effPrimary = 0;
    }

    gainPrimaryRef.current.gain.setValueAtTime(effPrimary, audioCtxRef.current.currentTime);
    gainBgRef.current.gain.setValueAtTime(effBg, audioCtxRef.current.currentTime);
  }, [volPrimary, volBg, mutePrimary, muteBg, soloTrack]);

  const stopSources = () => {
    if (sourcePrimaryRef.current) {
      try { sourcePrimaryRef.current.stop(); } catch (e) {}
      sourcePrimaryRef.current.disconnect();
      sourcePrimaryRef.current = null;
    }
    if (sourceBgRef.current) {
      try { sourceBgRef.current.stop(); } catch (e) {}
      sourceBgRef.current.disconnect();
      sourceBgRef.current = null;
    }
  };

  const playFromOffset = (offsetSec) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    stopSources();

    const startAudioTime = ctx.currentTime;
    startTimeRef.current = startAudioTime - offsetSec;
    pauseOffsetRef.current = offsetSec;

    // Source 1: Primary (Vocals)
    if (bufferPrimaryRef.current) {
      const s1 = ctx.createBufferSource();
      s1.buffer = bufferPrimaryRef.current;
      s1.connect(gainPrimaryRef.current);
      s1.start(startAudioTime, offsetSec);
      sourcePrimaryRef.current = s1;
      s1.onended = () => {
        if (ctx.currentTime - startTimeRef.current >= (bufferPrimaryRef.current?.duration || 0)) {
          setIsPlaying(false);
          pauseOffsetRef.current = 0;
          setCurrentTime(0);
        }
      };
    }

    // Source 2: Background (Instruments/Other) - Locked to identical hardware sample clock
    if (bufferBgRef.current) {
      const s2 = ctx.createBufferSource();
      s2.buffer = bufferBgRef.current;
      s2.connect(gainBgRef.current);
      s2.start(startAudioTime, offsetSec);
      sourceBgRef.current = s2;
    }

    setIsPlaying(true);
    trackProgress();
  };

  const trackProgress = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const update = () => {
      if (audioCtxRef.current && isPlaying) {
        const curr = audioCtxRef.current.currentTime - startTimeRef.current;
        if (curr <= duration) {
          setCurrentTime(curr);
          animFrameRef.current = requestAnimationFrame(update);
        } else {
          setIsPlaying(false);
          setCurrentTime(0);
          pauseOffsetRef.current = 0;
        }
      }
    };
    animFrameRef.current = requestAnimationFrame(update);
  };

  const togglePlay = () => {
    if (isPlaying) {
      pauseOffsetRef.current = audioCtxRef.current ? audioCtxRef.current.currentTime - startTimeRef.current : currentTime;
      stopSources();
      setIsPlaying(false);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    } else {
      playFromOffset(pauseOffsetRef.current);
    }
  };

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    pauseOffsetRef.current = newTime;
    if (isPlaying) {
      playFromOffset(newTime);
    }
  };

  const formatTime = (sec) => {
    if (isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (!primaryStemUrl) return null;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl mb-8 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">{title}</h3>
            <p className="text-xs text-slate-400">Synchronized Web Audio API multi-track stem engine (zero drift)</p>
          </div>
        </div>

        {isLoading ? (
          <span className="text-xs text-purple-400 font-mono animate-pulse">Loading audio buffers...</span>
        ) : loadError ? (
          <span className="text-xs text-rose-400 font-mono">{loadError}</span>
        ) : null}
      </div>

      {/* Main Transport & Timeline Seek Bar */}
      <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 mb-5">
        <div className="flex items-center gap-4 mb-3">
          <button
            onClick={togglePlay}
            disabled={isLoading}
            className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-indigo-500/25 transition active:scale-95 disabled:opacity-50 shrink-0"
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          <div className="flex-1">
            <input
              type="range"
              min="0"
              max={duration || 100}
              step="0.1"
              value={currentTime}
              onChange={handleSeek}
              disabled={isLoading}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <div className="flex justify-between text-xs font-mono text-slate-400 mt-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Track Faders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Primary Stem (Vocals) */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Music className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-semibold text-slate-200">Vocals / Primary Stem</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSoloTrack(soloTrack === 'primary' ? null : 'primary')}
                className={`px-2 py-0.5 text-[10px] font-bold rounded ${soloTrack === 'primary' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                SOLO
              </button>
              <button
                onClick={() => setMutePrimary(!mutePrimary)}
                className={`p-1.5 rounded-lg ${mutePrimary ? 'bg-rose-500/20 text-rose-400' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {mutePrimary ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volPrimary}
              onChange={(e) => setVolPrimary(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <span className="text-xs font-mono text-slate-400 w-9 text-right">{Math.round(volPrimary * 100)}%</span>
          </div>
        </div>

        {/* Background Stem (Instrumental / Other) */}
        {bgStemUrl && (
          <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-semibold text-slate-200">Background / Accompaniment</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSoloTrack(soloTrack === 'bg' ? null : 'bg')}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded ${soloTrack === 'bg' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  SOLO
                </button>
                <button
                  onClick={() => setMuteBg(!muteBg)}
                  className={`p-1.5 rounded-lg ${muteBg ? 'bg-rose-500/20 text-rose-400' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {muteBg ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volBg}
                onChange={(e) => setVolBg(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <span className="text-xs font-mono text-slate-400 w-9 text-right">{Math.round(volBg * 100)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
