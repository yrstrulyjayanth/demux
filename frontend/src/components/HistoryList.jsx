import React from 'react';
import { History, ArrowRight, Music, Film, FileText, Trash2 } from 'lucide-react';

export default function HistoryList({ jobHistory, onSelectHistory, onClearHistory }) {
  if (!jobHistory || jobHistory.length === 0) return null;

  const getIcon = (type) => {
    switch (type) {
      case 'audio': return <Music className="w-3.5 h-3.5 text-indigo-400" />;
      case 'video': return <Film className="w-3.5 h-3.5 text-purple-400" />;
      case 'subtitles': return <FileText className="w-3.5 h-3.5 text-emerald-400" />;
      default: return <Music className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl mb-8 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-800 rounded-xl text-slate-400">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">Recent Job History</h3>
            <p className="text-xs text-slate-400">Click any previous task to reload outputs & Stem Mixer</p>
          </div>
        </div>

        <button
          onClick={onClearHistory}
          className="text-xs text-slate-500 hover:text-rose-400 flex items-center gap-1 transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>

      <div className="space-y-2">
        {jobHistory.map((item, idx) => (
          <div
            key={idx}
            onClick={() => onSelectHistory(item)}
            className="p-3 bg-slate-950/60 hover:bg-slate-800/60 border border-slate-800/60 rounded-xl flex items-center justify-between cursor-pointer transition group"
          >
            <div className="flex items-center gap-3 overflow-hidden">
              {getIcon(item.type)}
              <div className="overflow-hidden">
                <span className="text-xs font-medium text-slate-200 block truncate">{item.message}</span>
                <span className="text-[10px] text-slate-500 font-mono block">{item.timestamp}</span>
              </div>
            </div>

            <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition transform group-hover:translate-x-1 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
