import React, { useEffect, useState } from 'react';
import { Terminal, Square, RefreshCw, Cpu } from 'lucide-react';

export default function ProgressBar({ isProcessing, activeTask, progressPercent, liveLogText, onStop }) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    let interval;
    if (isProcessing) {
      setElapsedSec(0);
      interval = setInterval(() => setElapsedSec(prev => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isProcessing]);

  if (!isProcessing) return null;

  const formatElapsed = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-2xl p-6 shadow-2xl mb-8 animate-pulse-slow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
          <span className="font-semibold text-slate-100 text-sm">{activeTask || 'Processing Media...'}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 bg-slate-900/80 border border-slate-800 rounded-lg text-xs font-mono text-indigo-300 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>Time Elapsed: {formatElapsed(elapsedSec)}</span>
          </div>
          <button
            onClick={onStop}
            className="px-4 py-1.5 bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-md shadow-rose-600/20 transition active:scale-95"
            title="Terminate running process tree immediately"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            Stop Process
          </button>
        </div>
      </div>

      {/* Progress Bar Container */}
      <div className="relative w-full h-3 bg-slate-950 rounded-full overflow-hidden mb-3 border border-slate-800">
        <div 
          className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 rounded-full transition-all duration-300 ease-out relative"
          style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
        >
          <div className="absolute inset-0 bg-white/20 animate-shimmer" />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-slate-400 font-mono overflow-hidden">
          <Terminal className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">{liveLogText || 'Executing background pipeline...'}</span>
        </div>
        <span className="font-bold font-mono text-indigo-300 shrink-0 ml-4">{progressPercent}%</span>
      </div>
    </div>
  );
}
