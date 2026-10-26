import React, { useState } from 'react';
import { 
  CheckCircle2, 
  FolderOpen, 
  Download, 
  FileText, 
  Copy, 
  Check, 
  Eye,
  Film,
  Music,
  Sparkles
} from 'lucide-react';
import SubtitlePreviewModal from './SubtitlePreviewModal';

export default function ResultCard({ resultData, onOpenFolder }) {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);

  if (!resultData) return null;

  const handleCopyCommand = () => {
    if (!resultData.command) return;
    navigator.clipboard.writeText(resultData.command);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl mb-8 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">Job Complete</h3>
            <p className="text-xs text-slate-400">{resultData.message}</p>
          </div>
        </div>

        {resultData.outputDir && (
          <button
            onClick={() => onOpenFolder(resultData.outputDir)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl flex items-center gap-1.5 transition shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Open Folder
          </button>
        )}
      </div>

      {/* Primary Outputs & Downloads */}
      <div className="space-y-3">
        {/* Audio Separation Results */}
        {resultData.type === 'audio' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {resultData.primaryStemUrl && (
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2 overflow-hidden">
                  <Music className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="text-xs font-medium text-slate-200 truncate">Isolated Vocals / Primary Stem</span>
                </div>
                <a
                  href={resultData.primaryStemUrl}
                  download
                  className="px-3 py-1 bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg flex items-center gap-1 shrink-0 transition"
                >
                  <Download className="w-3 h-3" />
                  <span>Download</span>
                </a>
              </div>
            )}
            {resultData.bgStemUrl && (
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2 overflow-hidden">
                  <Music className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="text-xs font-medium text-slate-200 truncate">Background Accompaniment</span>
                </div>
                <a
                  href={resultData.bgStemUrl}
                  download
                  className="px-3 py-1 bg-purple-600/90 hover:bg-purple-500 text-white text-xs font-medium rounded-lg flex items-center gap-1 shrink-0 transition"
                >
                  <Download className="w-3 h-3" />
                  <span>Download</span>
                </a>
              </div>
            )}
          </div>
        )}

        {/* Video Conversion Results */}
        {resultData.type === 'video' && resultData.videoUrl && (
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              <Film className="w-4 h-4 text-purple-400 shrink-0" />
              <span className="text-xs font-medium text-slate-200 truncate">{resultData.outputFile}</span>
            </div>
            <a
              href={resultData.videoUrl}
              download
              className="px-3 py-1 bg-purple-600/90 hover:bg-purple-500 text-white text-xs font-medium rounded-lg flex items-center gap-1 shrink-0 transition"
            >
              <Download className="w-3 h-3" />
              <span>Download Video</span>
            </a>
          </div>
        )}

        {/* Audio Converter Results */}
        {resultData.type === 'audio_conversion' && resultData.webUrl && (
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              <Music className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-medium text-slate-200 truncate">{resultData.outputFile}</span>
            </div>
            <a
              href={resultData.webUrl}
              download
              className="px-3 py-1 bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg flex items-center gap-1 shrink-0 transition"
            >
              <Download className="w-3 h-3" />
              <span>Download Audio</span>
            </a>
          </div>
        )}

        {/* Subtitle & XML Results (Fixes bug #14!) */}
        {resultData.type === 'subtitles' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {resultData.srtUrl && (
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-medium text-slate-200">SRT Subtitles</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPreviewFile({ url: resultData.srtUrl, name: 'SRT Subtitles' })}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                    title="Preview in browser"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={resultData.srtUrl}
                    download
                    className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                    title="Download SRT"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}

            {resultData.vttUrl && (
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-medium text-slate-200">VTT Web Subtitles</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPreviewFile({ url: resultData.vttUrl, name: 'VTT Subtitles' })}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                    title="Preview in browser"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={resultData.vttUrl}
                    download
                    className="p-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition"
                    title="Download VTT"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}

            {resultData.txtUrl && (
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-medium text-slate-200">TXT Transcript</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPreviewFile({ url: resultData.txtUrl, name: 'TXT Transcript' })}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                    title="Preview in browser"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={resultData.txtUrl}
                    download
                    className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition"
                    title="Download TXT"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Copy CLI Command */}
        {resultData.command && (
          <div className="mt-3 p-3 bg-slate-950/90 border border-slate-800/80 rounded-xl flex items-center justify-between">
            <div className="overflow-hidden mr-3">
              <span className="text-[10px] font-mono uppercase text-slate-500 block mb-0.5">Executed Command</span>
              <code className="text-xs font-mono text-slate-400 truncate block">{resultData.command}</code>
            </div>
            <button
              onClick={handleCopyCommand}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg flex items-center gap-1 shrink-0 transition"
            >
              {copiedCmd ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedCmd ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        )}
      </div>

      {/* In-Browser Preview Modal */}
      {previewFile && (
        <SubtitlePreviewModal
          fileUrl={previewFile.url}
          fileName={previewFile.name}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
