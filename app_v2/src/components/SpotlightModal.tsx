import React, { useState, useEffect, useRef } from 'react';
import { Search, Volume2, Star, Copy, X, Sparkles, BookOpen, Layers, Check } from 'lucide-react';
import { cmdQueryText, cmdGetHistory, cmdAddHistory } from '../services/tauri';
import type { TextQueryResponse, AppSettings, HistoryItem } from '../services/types';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAppTheme } from '../hooks/useAppTheme';

interface SpotlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
}

export const SpotlightModal: React.FC<SpotlightModalProps> = ({ isOpen, onClose, settings }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TextQueryResponse | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { isLight } = useAppTheme();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResult(null);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSearch = async (text?: string) => {
    const q = text !== undefined ? text : query;
    if (!q.trim()) return;
    setLoading(true);
    try {
      const res = await cmdQueryText(q.trim(), settings.defaultPreset, settings.llmConfig);
      setResult(res);

      const current = await cmdGetHistory();
      const existed = current.find((i) => i.original === res.original);
      setIsFavorite(Boolean(existed?.isFavorite));

      if (res.results.length > 0 && !existed) {
        const topResult = res.results[0];
        const newHist: HistoryItem = {
          id: `hist_${Date.now()}`,
          original: res.original,
          translated: topResult.translated,
          sourceTier: topResult.sourceTier,
          timestamp: new Date().toLocaleTimeString(),
          isFavorite: false,
        };
        await cmdAddHistory(newHist);
      }
    } catch (err) {
      console.error('Spotlight search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[300] flex items-start justify-center pt-[15vh] p-4 transition-colors animate-in fade-in duration-150 ${
        isLight ? 'bg-black/20 backdrop-blur-sm' : 'bg-black/60 backdrop-blur-md'
      }`}
      onClick={() => {
        if (settings.miniWindowCloseAction !== 'minimize') {
          onClose();
        }
      }}
    >
      <div
        className="lg-surface w-full max-w-2xl p-5 space-y-4 shadow-2xl transition-all animate-in zoom-in-95 duration-150"
        style={{
          background: isLight ? 'rgba(255,255,255,0.82)' : 'rgba(24,25,34,0.92)',
          borderRadius: 'var(--g-radius-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center space-x-3 border-b pb-3 border-slate-200 dark:border-white/10">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/15 text-blue-500">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
              placeholder="键入英文词条/短语，按 Enter 瞬间检索..."
              className={`w-full bg-transparent text-sm font-medium outline-none pr-8 ${
                isLight ? 'text-slate-900 placeholder:text-slate-400' : 'text-white placeholder:text-zinc-500'
              }`}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResult(null);
                  inputRef.current?.focus();
                }}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleSearch()}
            disabled={loading || !query.trim()}
            className="lg-btn lg-btn-primary !px-3.5 !py-1.5 !text-xs cursor-pointer"
          >
            {loading ? '检索中...' : '查词'}
          </button>
          <button
            type="button"
            onClick={onClose}
            title="关闭 (Esc)"
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              isLight ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100' : 'text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Empty state hint */}
        {!result && !loading && (
          <div className="py-8 text-center text-xs text-zinc-500 font-mono">
            支持按下 <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">Esc</kbd> 退出 | 实时多语言与 CG 专业词典极速检索
          </div>
        )}

        {/* Results view */}
        {result && (
          <div className="max-h-[55vh] overflow-y-auto space-y-4 pr-1">
            {result.wordDetail && (
              <div className={`p-4 rounded-xl border space-y-3 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.04] border-white/10'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <h3 className="text-lg font-bold text-blue-500">{result.original}</h3>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/15 text-sky-300 font-mono">
                      {result.wordDetail.cgDomainNote}
                    </span>
                  </div>
                  {(result.wordDetail.phoneticUs || result.wordDetail.phoneticUk) ? (
                    <div className="text-xs font-mono text-zinc-400">
                      {result.wordDetail.phoneticUs && `美 ${result.wordDetail.phoneticUs}`}
                      {result.wordDetail.phoneticUs && result.wordDetail.phoneticUk && ' | '}
                      {result.wordDetail.phoneticUk && `英 ${result.wordDetail.phoneticUk}`}
                    </div>
                  ) : (
                    result.wordDetail.pos ? (
                      <div className="text-xs font-mono text-zinc-400">
                        {result.wordDetail.pos}
                      </div>
                    ) : null
                  )}
                </div>
                <p className="text-sm font-semibold leading-relaxed">{result.wordDetail.definition}</p>
              </div>
            )}

            {result.results.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold text-zinc-400 flex items-center space-x-1">
                  <Layers className="h-3.5 w-3.5 text-blue-400" />
                  <span>多源对照 ({result.results.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {result.results.map((res, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border space-y-1.5 ${
                        isLight ? 'bg-white border-slate-200' : 'bg-white/[0.03] border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-sky-400">{res.engineName}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(res.translated, idx)}
                          className="flex items-center space-x-1 text-zinc-400 hover:text-white"
                        >
                          {copiedIndex === idx ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs leading-relaxed font-medium">{res.translated}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
