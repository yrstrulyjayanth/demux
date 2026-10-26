import React from 'react';
import { FolderOpen, FileCheck, AlertCircle, X, Sparkles } from 'lucide-react';

export default function FilePicker({ 
  filePath, 
  setFilePath, 
  customOutputDir, 
  setCustomOutputDir, 
  fileMetadata, 
  onBrowseFile, 
  onBrowseFolder 
}) {
  return (
    <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-2xl mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Media Input & Target Location</h2>
            <p className="text-xs text-slate-400">Select any video or audio file to demux, convert, or transcribe</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Main Source File Path */}
        <div>
          <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-1.5">
            Source File Path
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="C:\Users\Media\Video.mp4 or click Browse..."
                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
              {filePath && (
                <button
                  onClick={() => setFilePath('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                  title="Clear path"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              onClick={onBrowseFile}
              className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm rounded-xl flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition active:scale-95 shrink-0"
            >
              <FolderOpen className="w-4 h-4" />
              Browse File
            </button>
          </div>

          {/* File Metadata Badge */}
          {fileMetadata && (
            <div className="mt-2.5 flex items-center gap-3 text-xs">
              {fileMetadata.exists ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg">
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Valid Media: {fileMetadata.filename} ({fileMetadata.size_mb} MB)</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>File path does not exist on disk</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Optional Custom Output Directory */}
        <div>
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
            Custom Output Folder <span className="text-slate-500 font-normal">(Optional — defaults to project folder)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={customOutputDir}
              onChange={(e) => setCustomOutputDir(e.target.value)}
              placeholder="Default: Output directory (separated/, converted/, subtitles/)"
              className="flex-1 bg-slate-950/80 border border-slate-800/80 rounded-xl px-4 py-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition"
            />
            <button
              onClick={onBrowseFolder}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl flex items-center gap-1.5 transition shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
