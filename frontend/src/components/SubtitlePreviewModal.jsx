import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Download, FileText, Search } from 'lucide-react';

export default function SubtitlePreviewModal({ fileUrl, fileName, onClose }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!fileUrl) return;
    setLoading(true);
    setError('');

    fetch(fileUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch file content');
        return res.text();
      })
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [fileUrl]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredLines = searchQuery
    ? content.split('\n').filter((line) => line.toLowerCase().includes(searchQuery.toLowerCase()))
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">{fileName || 'Subtitle Preview'}</h3>
              <p className="text-xs text-slate-400">In-browser preview & export</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={loading || !!error}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 transition disabled:opacity-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Text'}</span>
            </button>
            {fileUrl && (
              <a
                href={fileUrl}
                download={fileName || 'subtitle'}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-2.5 border-b border-slate-800/60 bg-slate-950/40">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search subtitle transcript..."
              className="w-full bg-slate-950 border border-slate-800/80 rounded-xl pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed space-y-1 bg-slate-950/80 selection:bg-indigo-500 selection:text-white">
          {loading ? (
            <div className="text-center py-12 text-slate-400 animate-pulse">Loading file contents...</div>
          ) : error ? (
            <div className="text-center py-12 text-rose-400">Failed to load preview: {error}</div>
          ) : filteredLines ? (
            filteredLines.length > 0 ? (
              filteredLines.map((line, i) => (
                <div key={i} className="hover:bg-slate-800/40 px-2 py-0.5 rounded">
                  {line}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-slate-500">No matching lines found.</div>
            )
          ) : (
            content.split('\n').map((line, i) => (
              <div key={i} className="hover:bg-slate-800/40 px-2 py-0.5 rounded flex gap-4">
                <span className="text-slate-600 select-none w-8 text-right shrink-0">{i + 1}</span>
                <span>{line}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
