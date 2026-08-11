

import React, { useState } from "react";
import {
  Search,
  Volume2,
  Star,
  Copy,
  Sparkles,
  BookOpen,
  Layers,
  Check,
  X,
} from "lucide-react";
import { cmdQueryText, cmdGetHistory, cmdAddHistory, cmdToggleFavorite } from "../../services/tauri";
import type { TextQueryResponse, AppSettings, HistoryItem } from "../../services/types";
import { useSettingsStore } from "../../stores/useSettingsStore";

interface SearchPanelProps {
  settings: AppSettings;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({ settings }) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TextQueryResponse | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const { settings: globalSettings } = useSettingsStore();
  const activeTheme = globalSettings.appearance?.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  const handleSearch = async (textToSearch?: string) => {
    const q = textToSearch !== undefined ? textToSearch : query;
    if (!q.trim()) return;
    if (textToSearch) setQuery(textToSearch);
    setLoading(true);
    try {
      const res = await cmdQueryText(q, settings.defaultPreset, settings.llmConfig);
      setResult(res);

      // 从真实历史中同步收藏状态
      const current = await cmdGetHistory();
      const existed = current.find((i) => i.original === res.original);
      setIsFavorite(Boolean(existed?.isFavorite));

      // Save to history automatically
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
      console.error("Query failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSpeech = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleToggleFavorite = async () => {
    if (!result || result.results.length === 0) return;
    try {
      const current = await cmdGetHistory();
      const existed = current.find((i) => i.original === result.original);
      let fav: boolean;
      if (existed) {
        fav = await cmdToggleFavorite(existed.id);
      } else {
        const topResult = result.results[0];
        const newHist: HistoryItem = {
          id: `hist_${Date.now()}`,
          original: result.original,
          translated: result.wordDetail?.definition || topResult.translated,
          sourceTier: topResult.sourceTier,
          timestamp: new Date().toLocaleTimeString(),
          isFavorite: true,
        };
        await cmdAddHistory(newHist);
        fav = true;
      }
      setIsFavorite(fav);
    } catch (err) {
      console.error("Toggle favorite failed:", err);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* 精致 Spotlight 风格搜索框 */}
      <div className={`flex items-center rounded-2xl p-1.5 backdrop-blur-xl shadow-md transition-all duration-200 border ${
        isLight
          ? "bg-white border-slate-300 focus-within:border-blue-500 shadow-slate-300/40"
          : "bg-white/[0.05] border-white/12 focus-within:border-blue-500/50 focus-within:bg-white/[0.08]"
      }`}>
        <Search className="h-4.5 w-4.5 text-blue-500 ml-3 shrink-0" />
        <input
          type="text"
          className={`flex-1 bg-transparent px-3 py-2 text-sm focus:outline-none ${
            isLight ? "text-slate-900 placeholder-slate-400" : "text-zinc-100 placeholder-zinc-400"
          }`}
          placeholder="输入词条、CG 材质术语或短语 (如 Principled BSDF, Lumen)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResult(null);
            }}
            className={`p-1.5 rounded-lg transition mr-1 cursor-pointer ${
              isLight ? "hover:bg-slate-100 text-slate-400 hover:text-slate-700" : "hover:bg-white/10 text-zinc-400 hover:text-white"
            }`}
            title="清空"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => handleSearch()}
          disabled={loading}
          className="flex items-center space-x-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-95 text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-md shadow-blue-500/20 cursor-pointer disabled:opacity-50 shrink-0"
        >
          {loading ? (
            <span className="inline-block animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-blue-100" />
          )}
          <span>查询词条</span>
        </button>
      </div>

      {/* 极简无图 Empty State 隐形指示 */}
      {!result && !loading && (
        <div className="text-center py-12 space-y-2 select-none opacity-60">
          <p className={`text-xs font-mono ${isLight ? "text-slate-500" : "text-zinc-500"}`}>
            按 Enter 或点击“查询词条”获取音标、专业注解及多源对比结果
          </p>
        </div>
      )}

      {/* Detailed Word Card */}
      {result && result.wordDetail && (
        <div className={`relative overflow-hidden rounded-2xl p-6 space-y-4 shadow-xl backdrop-blur-xl border ${
          isLight
            ? "bg-white border-slate-200 shadow-slate-200/50 text-slate-800"
            : "bg-white/[0.04] border-white/12 text-zinc-100 shadow-2xl"
        }`}>
          {/* Top subtle accent bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-sky-400" />

          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-3">
                <h2 className={`text-2xl font-bold tracking-wide ${isLight ? "text-slate-900" : "text-white"}`}>{result.original}</h2>
                <span className={`text-xs px-3 py-1 rounded-full font-mono font-medium border shadow-xs ${
                  isLight ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-blue-500/15 border-blue-400/30 text-sky-300"
                }`}>
                  {result.wordDetail.cgDomainNote}
                </span>
              </div>
              <div className={`flex items-center space-x-4 mt-2 text-sm font-mono ${isLight ? "text-slate-500" : "text-zinc-400"}`}>
                <span>美 {result.wordDetail.phoneticUs}</span>
                <span>英 {result.wordDetail.phoneticUk}</span>
                <span className={`font-sans ${isLight ? "text-slate-400" : "text-zinc-500"}`}>{result.wordDetail.pos}</span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => handleSpeech(result.original)}
                className={`p-2.5 rounded-xl border transition cursor-pointer ${
                  isSpeaking
                    ? "bg-blue-600/30 border-blue-400 text-blue-500 shadow-md"
                    : (isLight ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700" : "bg-white/5 hover:bg-white/10 border-white/15 text-zinc-300")
                }`}
                title="美式发音朗读"
              >
                <Volume2 className={`h-5 w-5 ${isSpeaking ? "animate-pulse" : ""}`} />
              </button>
              <button
                type="button"
                onClick={handleToggleFavorite}
                className={`p-2.5 rounded-xl border transition cursor-pointer ${
                  isFavorite
                    ? "bg-amber-500/20 border-amber-400/50 text-amber-500 shadow-md"
                    : (isLight ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700" : "bg-white/5 hover:bg-white/10 border-white/15 text-zinc-300")
                }`}
                title={isFavorite ? "已加入生词本" : "加入生词本"}
              >
                <Star className={`h-5 w-5 ${isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
              </button>
            </div>
          </div>

          {/* Definition */}
          <div className={`p-4 rounded-xl border ${
            isLight ? "bg-slate-50 border-slate-200 text-slate-800" : "bg-black/20 border-white/5 text-zinc-200"
          }`}>
            <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${isLight ? "text-slate-500" : "text-zinc-400"}`}>释义</div>
            <p className="text-base font-bold leading-relaxed">{result.wordDetail.definition}</p>
          </div>

          {/* Context Sentences */}
          {result.wordDetail.examples.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className={`text-xs font-semibold uppercase tracking-wider flex items-center space-x-1.5 ${isLight ? "text-slate-500" : "text-zinc-400"}`}>
                <BookOpen className="h-3.5 w-3.5 text-blue-500" />
                <span>语境例句 / Context</span>
              </div>
              <div className="space-y-2">
                {result.wordDetail.examples.map((ex, idx) => (
                  <div key={idx} className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    isLight ? "bg-slate-50/70 border-slate-200 text-slate-700" : "bg-white/[0.02] border-white/5 text-zinc-300"
                  }`}>
                    <p className={`font-mono ${isLight ? "text-slate-900" : "text-zinc-200"}`}>{ex}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Multi-Engine Comparison List */}
      {result && result.results.length > 0 && (
        <div className="space-y-3">
          <div className={`flex items-center justify-between px-1 text-xs ${isLight ? "text-slate-500" : "text-zinc-400"}`}>
            <span className="font-semibold flex items-center space-x-1.5">
              <Layers className="h-3.5 w-3.5 text-blue-500" />
              <span>多通道引擎对照结果 ({result.results.length})</span>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {result.results.map((res, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-xl border space-y-2 transition shadow-sm ${
                  isLight
                    ? "bg-white border-slate-200 text-slate-800 hover:border-slate-300"
                    : "bg-white/[0.04] border-white/10 text-zinc-100 hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-semibold px-2 py-0.5 rounded-md border text-[11px] ${
                    isLight ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-blue-500/15 border-blue-400/30 text-sky-300"
                  }`}>
                    {res.engineName}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(res.translated, idx)}
                    className={`flex items-center space-x-1 px-2 py-1 rounded-md border text-[11px] transition ${
                      isLight
                        ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700"
                        : "bg-white/5 hover:bg-white/10 border-white/10 text-zinc-300"
                    }`}
                  >
                    {copiedIndex === idx ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-500" />
                        <span>已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>复制</span>
                      </>
                    )}
                  </button>
                </div>
                <p className={`text-sm font-medium leading-relaxed ${isLight ? "text-slate-800" : "text-zinc-100"}`}>{res.translated}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
