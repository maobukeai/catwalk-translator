import React, { useState, useEffect, useRef, useMemo } from "react";
import { Volume2, Star, Copy, X, Sparkles, Layers, Check, Clock, Search } from "lucide-react";
import {
  cmdQueryText,
  cmdGetHistory,
  cmdAddHistory,
  cmdToggleFavorite,
  cmdTranslatePhrasesStyled,
} from "../services/tauri";
import { speakText } from "../services/tts";
import type { TextQueryResponse, AppSettings, HistoryItem, LlmConfig } from "../services/types";
import { useAppTheme } from "../hooks/useAppTheme";

interface SpotlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
}

const SPOTLIGHT_FALLBACK_TERMS = [
  "Principled BSDF",
  "Subsurface Scattering",
  "Lumen",
  "Roughness",
];

function resolveSpotlightLlm(settings: AppSettings): LlmConfig | null {
  const pool =
    settings.llmConfigs && settings.llmConfigs.length > 0
      ? settings.llmConfigs
      : settings.llmConfig
      ? [settings.llmConfig]
      : [];
  const match = pool.find((c) => {
    if (c.enabled === false) return false;
    const ep = c.endpoint?.trim() || "";
    const isLocal = ep.includes("localhost") || ep.includes("127.0.0.1");
    return Boolean(c.apiKey?.trim() || (ep && isLocal));
  });
  return match || settings.llmConfig || null;
}

export const SpotlightModal: React.FC<SpotlightModalProps> = ({ isOpen, onClose, settings }) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TextQueryResponse | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [starAnimKey, setStarAnimKey] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [recentTerms, setRecentTerms] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const querySeqRef = useRef(0);

  const { isLight } = useAppTheme();
  const activeLlm = useMemo(() => resolveSpotlightLlm(settings), [settings]);

  useEffect(() => {
    if (!isOpen) {
      ++querySeqRef.current;
      return;
    }
    ++querySeqRef.current;
    setLoading(false);
    setQuery("");
    setResult(null);
    setIsFavorite(false);
    setCopiedIndex(null);
    setIsSpeaking(false);

    let cancelled = false;
    cmdGetHistory()
      .then((list) => {
        if (cancelled) return;
        const arr = Array.isArray(list) ? list : [];
        const seen = new Set<string>();
        const picks: string[] = [];
        for (const item of arr) {
          const val = item.original?.trim();
          const key = val?.toLowerCase();
          if (!val || !key || seen.has(key)) continue;
          seen.add(key);
          picks.push(val);
          if (picks.length >= 4) break;
        }
        setRecentTerms(picks);
      })
      .catch(() => {
        if (!cancelled) setRecentTerms([]);
      });

    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSearch = async (text?: string) => {
    const q = (text !== undefined ? text : query).trim();
    if (!q) return;
    if (text !== undefined) setQuery(q);

    const seq = ++querySeqRef.current;
    let mainResolved = false;
    setLoading(true);

    // Stage-0 闪电先锋快通道：毫秒级先行展示首屏释义
    const hasChinese = /[\u4e00-\u9fa5]/.test(q);
    const flashTarget = hasChinese ? "en" : "zh-CN";
    cmdTranslatePhrasesStyled(
      [q],
      settings.defaultPreset,
      null,
      settings.translationStyle,
      flashTarget
    )
      .then(([flash]) => {
        if (mainResolved || seq !== querySeqRef.current) return;
        const trans = flash?.translated?.trim();
        if (
          !trans ||
          trans.includes("点击重试") ||
          trans.includes("网络连接超时") ||
          trans.includes("未配置")
        ) {
          return;
        }
        const isShort = hasChinese ? q.length <= 15 : q.split(/\s+/).length <= 5;
        setResult({
          original: q,
          wordDetail: isShort
            ? {
                phoneticUs: "",
                phoneticUk: "",
                pos: hasChinese ? "常用词条 / 表达" : "通用 / 专业术语",
                definition: trans,
                examples: [],
                cgDomainNote: `极速直出 [${(settings.defaultPreset || "GENERAL").toUpperCase()}]`,
              }
            : null,
          results: [
            {
              engineName: flash.sourceTier ? `⚡ 极速快译 (${flash.sourceTier})` : "⚡ 极速快译",
              translated: trans,
              sourceTier: flash.sourceTier || "Online Fallback",
            },
          ],
        });
        setLoading(false);
      })
      .catch(() => {});

    try {
      const res = await cmdQueryText(q, settings.defaultPreset, activeLlm, {
        skipLlm: true,
        onlineEngines: settings.onlineEngines,
        presetDicts: settings.presetDicts,
        translationTiers: settings.translationTiers,
        style: settings.translationStyle,
      });
      if (seq !== querySeqRef.current) return;
      mainResolved = true;

      setResult(res);
      setLoading(false);

      cmdGetHistory()
        .then(async (current) => {
          if (seq !== querySeqRef.current) return;
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
        })
        .catch(() => {});
    } catch (err) {
      if (seq !== querySeqRef.current) return;
      mainResolved = true;
      console.error("Spotlight search error:", err);
      setLoading(false);
    }
  };

  const handleSpeech = (text: string) => {
    if (!text) return;
    setIsSpeaking(true);
    speakText(text, { lang: "en-US", onEnd: () => setIsSpeaking(false) });
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
      if (fav) setStarAnimKey((k) => k + 1);
    } catch (err) {
      console.error("Spotlight favorite toggle failed:", err);
    }
  };

  const handleCopy = (text: string, idx: number) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  if (!isOpen) return null;

  const isExpanded = Boolean(result || loading);
  const quickSuggestions = recentTerms.length > 0 ? recentTerms : SPOTLIGHT_FALLBACK_TERMS;

  return (
    <div
      className={`fixed inset-0 z-[300] flex flex-col items-center justify-start pt-[14vh] p-4 transition-colors animate-fade-in ${
        isLight ? "bg-slate-900/20 backdrop-blur-sm" : "bg-black/60 backdrop-blur-md"
      }`}
      onClick={() => {
        if (settings.miniWindowCloseAction !== "minimize") {
          onClose();
        }
      }}
    >
      {/* 方案 C：未查词时为悬浮单行灵动胶囊，查词后弹性向下展开词条大卡 */}
      <div
        data-testid="spotlight-shell"
        className={`spotlight-shell animate-spotlight-in w-full border shadow-2xl ${
          isExpanded
            ? "max-w-2xl rounded-[24px] p-5 space-y-4"
            : "max-w-xl rounded-full px-4 py-2"
        }`}
        style={{
          background: isLight ? "rgba(255, 255, 255, 0.90)" : "rgba(22, 24, 34, 0.92)",
          borderColor: "var(--g-border)",
          backdropFilter: "blur(var(--glass-blur)) saturate(170%)",
          WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(170%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部搜索输入行 */}
        <div
          className={`flex items-center space-x-3 ${
            isExpanded ? "border-b pb-3" : ""
          }`}
          style={isExpanded ? { borderColor: "var(--g-hairline)" } : undefined}
        >
          <div
            className={`flex shrink-0 items-center justify-center ${
              isExpanded ? "h-8 w-8 rounded-xl" : "h-7 w-7 rounded-full"
            }`}
            style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
          >
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1 relative min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="键入英文词条/短语，按 Enter 瞬间检索..."
              className={`w-full bg-transparent text-sm font-medium outline-none pr-7 ${
                isLight ? "text-slate-900 placeholder:text-slate-400" : "text-white placeholder:text-zinc-500"
              }`}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  ++querySeqRef.current;
                  setLoading(false);
                  setQuery("");
                  setResult(null);
                  setIsFavorite(false);
                  inputRef.current?.focus();
                }}
                className={`absolute right-0 top-1/2 -translate-y-1/2 cursor-pointer ${
                  isLight ? "text-slate-400 hover:text-slate-700" : "text-zinc-400 hover:text-white"
                }`}
                title="清空词条"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleSearch()}
            disabled={loading || !query.trim()}
            className={`lg-btn lg-btn-primary !px-3.5 !py-1.5 !text-xs cursor-pointer shrink-0 ${
              !isExpanded ? "!rounded-full" : ""
            }`}
          >
            {loading ? "检索中..." : "查词"}
          </button>
          <button
            type="button"
            onClick={onClose}
            title="关闭 (Esc)"
            className={`p-1.5 rounded-full transition cursor-pointer shrink-0 ${
              isLight ? "text-slate-400 hover:text-slate-700 hover:bg-black/5" : "text-zinc-400 hover:text-white hover:bg-white/10"
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 展开后的加载态或结果区 */}
        {isExpanded && (
          <div className="animate-spotlight-expand space-y-4">
            {loading ? (
              <div className="space-y-2.5 py-2">
                <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--accent-text)" }}>
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                  <span>正在检索词库与多源释义...</span>
                </div>
                <div className="liquid-shimmer-bar h-5 rounded-lg w-1/2" />
                <div className="liquid-shimmer-bar h-4 rounded-md w-4/5" />
                <div className="liquid-shimmer-bar h-4 rounded-md w-2/3" />
              </div>
            ) : result ? (
              <div className="max-h-[55vh] overflow-y-auto space-y-4 pr-1 scrollbar-thin">
                {result.wordDetail && (
                  <div
                    className="p-4 rounded-2xl border space-y-2.5"
                    style={{
                      background: "var(--g-surface-2)",
                      borderColor: "var(--g-hairline)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-extrabold tracking-tight" style={{ color: "var(--accent-text)" }}>
                            {result.original}
                          </h3>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-mono border ${
                              isLight
                                ? "bg-blue-50 border-blue-200 text-blue-700"
                                : "bg-blue-500/15 border-blue-400/30 text-sky-300"
                            }`}
                          >
                            {result.wordDetail.cgDomainNote}
                          </span>
                        </div>
                        {(result.wordDetail.phoneticUs || result.wordDetail.phoneticUk || result.wordDetail.pos) && (
                          <div className="flex items-center flex-wrap gap-2.5 text-xs font-mono" style={{ color: "var(--g-text-2)" }}>
                            {result.wordDetail.phoneticUs ? <span>美 {result.wordDetail.phoneticUs}</span> : null}
                            {result.wordDetail.phoneticUk ? <span>英 {result.wordDetail.phoneticUk}</span> : null}
                            {result.wordDetail.pos ? <span className="font-sans opacity-80">{result.wordDetail.pos}</span> : null}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          data-testid="spotlight-speak-btn"
                          onClick={() => handleSpeech(result.original)}
                          className={`p-2 rounded-xl border transition cursor-pointer ${
                            isSpeaking ? "animate-speak-ripple bg-blue-600/20 border-blue-400 text-blue-500" : "hover:bg-[var(--g-surface-3)]"
                          }`}
                          style={
                            !isSpeaking
                              ? {
                                  background: "var(--g-surface)",
                                  borderColor: "var(--g-hairline)",
                                  color: "var(--g-text-1)",
                                }
                              : undefined
                          }
                          title="朗读词条"
                        >
                          <Volume2 className={`h-4 w-4 ${isSpeaking ? "animate-pulse" : ""}`} />
                        </button>
                        <button
                          key={starAnimKey}
                          type="button"
                          data-testid="spotlight-fav-btn"
                          onClick={handleToggleFavorite}
                          className={`p-2 rounded-xl border transition cursor-pointer ${
                            isFavorite ? "bg-amber-500/20 border-amber-400/50 text-amber-500" : "hover:bg-[var(--g-surface-3)]"
                          } ${isFavorite && starAnimKey > 0 ? "animate-star-bounce" : ""}`}
                          style={
                            !isFavorite
                              ? {
                                  background: "var(--g-surface)",
                                  borderColor: "var(--g-hairline)",
                                  color: "var(--g-text-1)",
                                }
                              : undefined
                          }
                          title={isFavorite ? "已加入生词本" : "加入生词本"}
                        >
                          <Star className={`h-4 w-4 ${isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                        </button>
                      </div>
                    </div>

                    <p className={`text-sm font-semibold leading-relaxed ${isLight ? "text-slate-900" : "text-zinc-100"}`}>
                      {result.wordDetail.definition}
                    </p>
                  </div>
                )}

                {result.results.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold flex items-center space-x-1.5" style={{ color: "var(--g-text-2)" }}>
                      <Layers className="h-3.5 w-3.5" style={{ color: "var(--accent-text)" }} />
                      <span>多源对照 ({result.results.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {result.results.map((res, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl border space-y-1.5"
                          style={{
                            background: "var(--g-surface-2)",
                            borderColor: "var(--g-hairline)",
                          }}
                        >
                          <div className="flex items-center justify-between text-[11px] gap-2">
                            <span className="font-semibold truncate" style={{ color: "var(--accent-text)" }}>
                              {res.engineName}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(res.translated, idx)}
                              className="flex items-center space-x-1 cursor-pointer transition hover:text-[var(--g-text-1)] shrink-0"
                              style={{ color: "var(--g-text-3)" }}
                              title="复制译文"
                            >
                              {copiedIndex === idx ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                          <p className={`text-xs leading-relaxed font-medium ${isLight ? "text-slate-800" : "text-zinc-100"}`}>
                            {res.translated}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div
              className="flex items-center justify-between text-[11px] pt-2 border-t font-mono"
              style={{ borderColor: "var(--g-hairline)", color: "var(--g-text-3)" }}
            >
              <span>Enter 查词</span>
              <span>Esc 关闭弹窗</span>
            </div>
          </div>
        )}
      </div>

      {/* 未展开时的轻量悬浮联想标签条（贴合单行胶囊下方，点按瞬查） */}
      {!isExpanded && (
        <div
          data-testid="spotlight-quick-chips"
          className="mt-3 max-w-xl w-full flex flex-wrap items-center justify-center gap-1.5 animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className="text-[11px] font-medium flex items-center gap-1 mr-1"
            style={{ color: isLight ? "rgba(255,255,255,0.9)" : "var(--g-text-3)" }}
          >
            {recentTerms.length > 0 ? <Clock className="h-3 w-3" /> : <Search className="h-3 w-3" />}
            <span>{recentTerms.length > 0 ? "最近:" : "热词:"}</span>
          </span>
          {quickSuggestions.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => handleSearch(term)}
              className="px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-all duration-150 cursor-pointer hover:-translate-y-0.5 active:scale-95 backdrop-blur-md"
              style={{
                background: isLight ? "rgba(255,255,255,0.82)" : "rgba(24,26,38,0.78)",
                borderColor: "var(--g-border)",
                color: isLight ? "#0f172a" : "#e2e8f0",
              }}
            >
              {term}
            </button>
          ))}
          <span
            className="text-[10.5px] font-mono ml-1 px-2 py-0.5 rounded-full border backdrop-blur-md"
            style={{
              background: isLight ? "rgba(255,255,255,0.68)" : "rgba(24,26,38,0.65)",
              borderColor: "var(--g-hairline)",
              color: isLight ? "#334155" : "var(--g-text-3)",
            }}
          >
            Esc 退出
          </span>
        </div>
      )}
    </div>
  );
};
