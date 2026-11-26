import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Volume2,
  Star,
  Copy,
  Sparkles,
  Layers,
  Check,
  X,
  Clock,
  TextCursorInput,
  MousePointer2,
  Keyboard,
  Settings,
  RotateCw,
  Lightbulb,
  Tag,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import {
  cmdQueryText,
  cmdGetHistory,
  cmdAddHistory,
  cmdToggleFavorite,
  cmdTranslatePhrasesStyled,
  cmdUniversalTranslate,
  fetchAiWordContext,
} from "../../services/tauri";
import { speakText } from "../../services/tts";
import type {
  TextQueryResponse,
  AppSettings,
  HistoryItem,
  AiWordContext,
  LlmConfig,
} from "../../services/types";
import { useAppTheme } from "../../hooks/useAppTheme";

interface SearchPanelProps {
  settings: AppSettings;
  onOpenSettings?: () => void;
}

/** 空状态常用术语快捷标签（点按即查） */
const CG_QUICK_TERMS = [
  "Principled BSDF",
  "Subsurface Scattering",
  "Normal Map",
  "PBR",
  "Lumen",
  "Nanite",
  "Topology",
  "Roughness",
];

function isReadyLlm(cfg?: LlmConfig | null): cfg is LlmConfig {
  if (!cfg || cfg.enabled === false) return false;
  const ep = cfg.endpoint?.trim() || "";
  const isLocal = ep.includes("localhost") || ep.includes("127.0.0.1");
  return Boolean(cfg.apiKey?.trim() || (ep && isLocal));
}

function highlightQueryTerm(text: string, term: string, transTerm?: string) {
  if (!text || (!term?.trim() && !transTerm?.trim())) return text;
  const termsToHighlight = [term, transTerm]
    .filter(Boolean)
    .map((t) => t!.trim())
    .filter((t) => t.length > 1);
  if (termsToHighlight.length === 0) return text;

  const escaped = termsToHighlight
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, i) => {
    const isMatched = termsToHighlight.some(
      (t) => t.toLowerCase() === part.toLowerCase()
    );
    return isMatched ? (
      <span
        key={i}
        className="font-bold text-blue-600 dark:text-sky-300 bg-blue-500/10 dark:bg-blue-400/20 px-1 py-0.5 rounded transition"
      >
        {part}
      </span>
    ) : (
      part
    );
  });
}

export const SearchPanel: React.FC<SearchPanelProps> = ({ settings, onOpenSettings }) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TextQueryResponse | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [starAnimKey, setStarAnimKey] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [recent, setRecent] = useState<HistoryItem[]>([]);
  const [aiContext, setAiContext] = useState<AiWordContext | null>(null);
  const [aiContextLoading, setAiContextLoading] = useState(false);
  const [copiedAiKey, setCopiedAiKey] = useState<string | null>(null);
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const querySeqRef = useRef(0);

  const { isLight } = useAppTheme();

  const activeLlm = useMemo<LlmConfig | null>(() => {
    const pool =
      settings.llmConfigs && settings.llmConfigs.length > 0
        ? settings.llmConfigs
        : settings.llmConfig
        ? [settings.llmConfig]
        : [];
    return pool.find(isReadyLlm) || null;
  }, [settings.llmConfigs, settings.llmConfig]);
  const hasActiveLlm = Boolean(activeLlm);

  // 最近查询：历史按最新在前存储，去重后取前 6 条作为一键回查入口
  const loadRecent = async () => {
    try {
      const all = await cmdGetHistory();
      const list = Array.isArray(all) ? all : [];
      const seen = new Set<string>();
      const dedup: HistoryItem[] = [];
      for (const item of list) {
        const key = item.original.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        dedup.push(item);
        if (dedup.length >= 6) break;
      }
      setRecent(dedup);
    } catch (err) {
      console.error("Load recent failed:", err);
    }
  };

  useEffect(() => {
    loadRecent();
  }, []);

  // 按 / 键快速聚焦搜索框（非输入状态下）
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const loadAiContext = async (
    word: string,
    mainTrans: string,
    bypassCache: boolean = false
  ) => {
    if (!word.trim()) return;
    if (!activeLlm) {
      setAiContext(null);
      setAiContextLoading(false);
      return;
    }

    setAiContextLoading(true);
    try {
      const ctx = await fetchAiWordContext(
        word,
        mainTrans,
        activeLlm,
        settings.defaultPreset,
        bypassCache
      );
      setAiContext(ctx);
    } catch (err) {
      console.warn("Failed to load AI word context:", err);
    } finally {
      setAiContextLoading(false);
    }
  };

  const handleCopyAiText = (key: string, text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedAiKey(key);
    setTimeout(() => setCopiedAiKey(null), 2000);
  };

  const handleSearch = async (textToSearch?: string) => {
    const trimmed = (textToSearch !== undefined ? textToSearch : query).trim();
    if (!trimmed) return;
    if (textToSearch !== undefined) setQuery(trimmed);

    const seq = ++querySeqRef.current;
    let mainResolved = false;
    setLoading(true);
    setAiContext(null);

    // Stage-0 闪电先锋快通道：毫秒级竞速直出首屏释义，不等待全量引擎
    const hasChinese = /[\u4e00-\u9fa5]/.test(trimmed);
    const flashTarget = hasChinese ? "en" : "zh-CN";
    cmdTranslatePhrasesStyled(
      [trimmed],
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
        const isShort = hasChinese ? trimmed.length <= 15 : trimmed.split(/\s+/).length <= 5;
        setResult({
          original: trimmed,
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
      const res = await cmdQueryText(trimmed, settings.defaultPreset, activeLlm || settings.llmConfig, {
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

      if (res.wordDetail) {
        loadAiContext(res.original, res.wordDetail.definition, false);
      }

      // 历史读写改为异步后台执行，不阻塞结果卡片上屏
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
            if (seq === querySeqRef.current) loadRecent();
          }
        })
        .catch((err) => console.warn("History sync failed:", err));

      // Stage-2：若已配置 AI 大模型且允许渐进精翻，后台无感追加 AI 深度对照卡
      if (activeLlm && settings.enableLlmProgressiveRefine !== false) {
        cmdUniversalTranslate({
          text: res.original,
          sourceLang: "auto",
          targetLang: "auto",
          preset: settings.defaultPreset,
          llmConfig: activeLlm,
          llmConfigs: settings.llmConfigs,
          style: settings.translationStyle,
          forcedEngine: "llm",
        })
          .then((aiRes) => {
            if (seq !== querySeqRef.current) return;
            const aiEngine = aiRes.engines?.find(
              (e) =>
                (e.sourceTier === "LLM API" ||
                  e.engineName.includes("深度翻译") ||
                  e.engineName.includes("AI")) &&
                e.sourceTier !== "LLM (Config Required)" &&
                e.sourceTier !== "LLM (Auth Error)" &&
                e.sourceTier !== "LLM (Quota Error)" &&
                e.sourceTier !== "Online (Retry)" &&
                e.translated?.trim() &&
                !e.translated.includes("未配置") &&
                !e.translated.includes("点击重试")
            );
            if (!aiEngine) return;
            const formattedAi = {
              ...aiEngine,
              engineName: aiEngine.engineName.includes("✨")
                ? aiEngine.engineName
                : `✨ ${aiEngine.engineName}`,
            };
            setResult((prev) => {
              if (!prev || prev.original !== res.original) return prev;
              const filtered = prev.results.filter(
                (e) =>
                  e.sourceTier !== "LLM API" &&
                  !e.engineName.includes("深度翻译") &&
                  !e.engineName.includes("AI 深度")
              );
              return {
                ...prev,
                results: [formattedAi, ...filtered],
              };
            });
          })
          .catch(() => {});
      }
    } catch (err) {
      if (seq !== querySeqRef.current) return;
      mainResolved = true;
      console.error("Query failed:", err);
      setLoading(false);
    }
  };

  const handleSpeech = (text: string) => {
    setIsSpeaking(true);
    speakText(text, { lang: "en-US", onEnd: () => setIsSpeaking(false) });
  };

  const handleCopy = (text: string, index: number) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
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
      if (fav) setStarAnimKey((k) => k + 1);
      loadRecent();
    } catch (err) {
      console.error("Toggle favorite failed:", err);
    }
  };

  // 空状态无感查词提示（依据设置动态生成）
  const hoverModLabel =
    settings.hoverLookupModifier === "alt" ? "Alt" : settings.hoverLookupModifier === "shift" ? "Shift" : "Ctrl";
  const emptyTips: { icon: React.ReactNode; text: string }[] = [
    ...(settings.selectionLookupEnabled
      ? [{ icon: <TextCursorInput className="h-3.5 w-3.5 text-blue-500" />, text: "划选屏幕文字，自动弹出翻译词卡" }]
      : []),
    ...(settings.hoverLookupEnabled
      ? [{ icon: <MousePointer2 className="h-3.5 w-3.5 text-blue-500" />, text: `按住 ${hoverModLabel} 悬停屏幕文字取词` }]
      : []),
    { icon: <Keyboard className="h-3.5 w-3.5 text-blue-500" />, text: `${settings.spotlightHotkey || "Alt+Space"} 随时呼出查词窗` },
  ];
  if (!settings.selectionLookupEnabled || !settings.hoverLookupEnabled) {
    emptyTips.push({ icon: <Settings className="h-3.5 w-3.5 text-blue-500" />, text: "设置中可开启划词 / 悬停无感查词" });
  }

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-24">
      {/* Slim Page Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-all ${
              isLight
                ? "bg-blue-500/10 border-blue-500/20 text-blue-600 shadow-xs"
                : "bg-white/[0.06] border-white/10 text-sky-400 shadow-inner backdrop-blur-md"
            }`}
          >
            <Search className="h-4 w-4" />
          </span>
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <h1 className={`text-base font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>划词查词</h1>
            <p className={`text-xs ${isLight ? "text-slate-500 font-medium" : "text-zinc-400"}`}>
              单词 · 短语 · CG 术语即时释义与多源对照
            </p>
          </div>
        </div>

        <span
          className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono border"
          style={{
            background: "var(--g-surface-2)",
            borderColor: "var(--g-hairline)",
            color: "var(--g-text-3)",
          }}
        >
          按 / 聚焦查词
        </span>
      </div>

      {/* 方案 C 顶部搜索行：液态玻璃 Hero 搜索栏 + 内联 AI 语境副驾抽屉开关 */}
      <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
        <div className="search-hero-shell flex-1 min-w-0 flex items-center !rounded-2xl p-1.5">
          <Search className="h-4.5 w-4.5 ml-3 shrink-0" style={{ color: "var(--accent-text)" }} />
          <input
            ref={searchInputRef}
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
                ++querySeqRef.current;
                setLoading(false);
                setQuery("");
                setResult(null);
              }}
              className={`p-1.5 rounded-lg transition mr-1 cursor-pointer ${
                isLight ? "hover:bg-black/5 text-slate-400 hover:text-slate-700" : "hover:bg-white/10 text-zinc-400 hover:text-white"
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
            className="lg-btn lg-btn-primary px-4 py-2 rounded-xl text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <span className="inline-block animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>查询词条</span>
          </button>
        </div>

        {result?.wordDetail && (
          <button
            type="button"
            data-testid="search-ai-drawer-toggle"
            onClick={() => setIsAiDrawerOpen((p) => !p)}
            className="lg-btn px-3.5 py-2.5 rounded-2xl text-xs font-medium flex items-center gap-1.5 cursor-pointer shrink-0"
            title={isAiDrawerOpen ? "收起右侧 AI 语境副驾抽屉" : "展开右侧 AI 语境副驾抽屉"}
          >
            {isAiDrawerOpen ? (
              <>
                <PanelRightClose className="h-3.5 w-3.5" style={{ color: "var(--accent-text)" }} />
                <span>收起 AI 语境副驾</span>
              </>
            ) : (
              <>
                <PanelRightOpen className="h-3.5 w-3.5" style={{ color: "var(--accent-text)" }} />
                <span>展开 AI 语境副驾</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* 加载态：流光液态骨架屏 */}
      {loading && (
        <div className="translator-pane rounded-2xl p-6 space-y-3 animate-card-in">
          <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--accent-text)" }}>
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            <span>正在检索专业词库与多源引擎释义...</span>
          </div>
          <div className="liquid-shimmer-bar h-6 rounded-lg w-1/3" />
          <div className="liquid-shimmer-bar h-4 rounded-md w-2/3" />
          <div className="liquid-shimmer-bar h-4 rounded-md w-1/2" />
        </div>
      )}

      {/* 空状态：快捷术语 + 最近查询 + 无感查词提示 */}
      {!result && !loading && (
        <div className="translator-pane rounded-2xl p-5 space-y-5 animate-card-in">
          {/* 常用术语快捷标签 */}
          <div className="space-y-2.5">
            <div className={`flex items-center space-x-1.5 px-0.5 text-xs font-semibold ${isLight ? "text-slate-600" : "text-zinc-300"}`}>
              <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--accent-text)" }} />
              <span>常用术语 · 点按即查</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {CG_QUICK_TERMS.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => handleSearch(term)}
                  className="flex items-center space-x-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer hover:-translate-y-0.5 active:scale-95 hover:bg-[var(--g-surface-3)]"
                  style={{
                    background: "var(--g-surface-2)",
                    borderColor: "var(--g-hairline)",
                    color: "var(--g-text-1)",
                  }}
                >
                  <Search className="h-3 w-3 opacity-60" />
                  <span>{term}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 最近查询（一键回查） */}
          {recent.length > 0 && (
            <div className="space-y-2.5">
              <div className={`flex items-center space-x-1.5 px-0.5 text-xs font-semibold ${isLight ? "text-slate-600" : "text-zinc-300"}`}>
                <Clock className="h-3.5 w-3.5" style={{ color: "var(--accent-text)" }} />
                <span>最近查询</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {recent.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSearch(item.original)}
                    className="p-3.5 rounded-xl border text-left space-y-1 transition-all duration-150 cursor-pointer hover:-translate-y-0.5 active:scale-[0.98] hover:bg-[var(--g-surface-3)]"
                    style={{
                      background: "var(--g-surface-2)",
                      borderColor: "var(--g-hairline)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm font-bold truncate ${isLight ? "text-slate-900" : "text-white"}`}>
                        {item.original}
                      </span>
                      {item.isFavorite && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                    </div>
                    <p className={`text-xs truncate ${isLight ? "text-slate-500" : "text-zinc-400"}`}>{item.translated}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 无感查词提示条 */}
          <div
            className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl border px-5 py-3 text-xs select-none ${
              isLight ? "text-slate-600" : "text-zinc-300"
            }`}
            style={{
              background: "var(--g-surface-2)",
              borderColor: "var(--g-hairline)",
            }}
          >
            {emptyTips.map((tip, idx) => (
              <span key={idx} className="flex items-center space-x-1.5">
                {tip.icon}
                <span>{tip.text}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 方案 C：左沉浸词头 + 多源对照整合卡 | 右可折叠 AI 语境副驾抽屉（780px+ 桌面默认并排展示） */}
      {result && !loading && (
        <div className="flex flex-col min-[780px]:flex-row gap-4 items-start">
          {/* 左侧主玻璃卡：沉浸大词头 + 释义 + 多源引擎并行对照 */}
          <div
            className={`flex-1 min-w-0 w-full translator-pane animate-trans-in rounded-2xl p-5 sm:p-6 space-y-5 ${
              isLight ? "text-slate-800" : "text-zinc-100"
            }`}
          >
            {result.wordDetail && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[11px] px-2.5 py-0.5 rounded-full font-mono font-semibold border ${
                          isLight
                            ? "bg-blue-50 border-blue-200 text-blue-700"
                            : "bg-blue-500/15 border-blue-400/30 text-sky-300"
                        }`}
                      >
                        {result.wordDetail.cgDomainNote}
                      </span>
                      {result.wordDetail.pos && (
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-md font-sans border"
                          style={{
                            background: "var(--g-surface-2)",
                            borderColor: "var(--g-hairline)",
                            color: "var(--g-text-2)",
                          }}
                        >
                          {result.wordDetail.pos}
                        </span>
                      )}
                    </div>

                    <h2 className={`text-2xl sm:text-[26px] font-extrabold tracking-tight break-words ${isLight ? "text-slate-900" : "text-white"}`}>
                      {result.original}
                    </h2>

                    {(result.wordDetail.phoneticUs || result.wordDetail.phoneticUk) && (
                      <div className={`flex items-center flex-wrap gap-3 text-sm font-mono ${isLight ? "text-slate-500" : "text-zinc-400"}`}>
                        {result.wordDetail.phoneticUs ? (
                          <button
                            type="button"
                            onClick={() => handleSpeech(result.original)}
                            className="hover:text-[var(--accent-text)] transition cursor-pointer"
                            title="点击朗读美音"
                          >
                            美 {result.wordDetail.phoneticUs}
                          </button>
                        ) : null}
                        {result.wordDetail.phoneticUk ? (
                          <button
                            type="button"
                            onClick={() => handleSpeech(result.original)}
                            className="hover:text-[var(--accent-text)] transition cursor-pointer"
                            title="点击朗读英音"
                          >
                            英 {result.wordDetail.phoneticUk}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSpeech(result.original)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                        isSpeaking
                          ? "animate-speak-ripple bg-blue-600/20 border-blue-400 text-blue-500"
                          : "hover:bg-[var(--g-surface-3)]"
                      }`}
                      style={
                        !isSpeaking
                          ? {
                              background: "var(--g-surface-2)",
                              borderColor: "var(--g-hairline)",
                              color: "var(--g-text-1)",
                            }
                          : undefined
                      }
                      title="美式发音朗读"
                    >
                      <Volume2 className={`h-3.5 w-3.5 ${isSpeaking ? "animate-pulse" : ""}`} />
                      <span>{isSpeaking ? "朗读中" : "朗读"}</span>
                    </button>
                    <button
                      key={starAnimKey}
                      type="button"
                      onClick={handleToggleFavorite}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                        isFavorite
                          ? "bg-amber-500/20 border-amber-400/50 text-amber-500 shadow-sm"
                          : "hover:bg-[var(--g-surface-3)]"
                      } ${isFavorite && starAnimKey > 0 ? "animate-star-bounce" : ""}`}
                      style={
                        !isFavorite
                          ? {
                              background: "var(--g-surface-2)",
                              borderColor: "var(--g-hairline)",
                              color: "var(--g-text-1)",
                            }
                          : undefined
                      }
                      title={isFavorite ? "已加入生词本" : "加入生词本"}
                    >
                      <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                      <span>{isFavorite ? "已收藏" : "收藏"}</span>
                    </button>
                  </div>
                </div>

                {/* 核心释义卡片 */}
                <div
                  className={`p-4 rounded-xl border ${isLight ? "text-slate-800" : "text-zinc-100"}`}
                  style={{
                    background: "var(--g-surface-2)",
                    borderColor: "var(--g-hairline)",
                  }}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--g-text-3)" }}>
                    释义
                  </div>
                  <p className="text-base font-bold leading-relaxed">{result.wordDetail.definition}</p>
                </div>

                {!isAiDrawerOpen && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsAiDrawerOpen(true)}
                      className="text-xs font-medium flex items-center gap-1 cursor-pointer hover:underline"
                      style={{ color: "var(--accent-text)" }}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>展开右侧 AI 语境例句与高频搭配 →</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 多通道引擎对照结果（整合进主词头玻璃卡下半区，聚焦对照） */}
            {result.results.length > 0 && (
              <div
                className={`space-y-3 ${result.wordDetail ? "pt-4 border-t" : ""}`}
                style={result.wordDetail ? { borderColor: "var(--g-hairline)" } : undefined}
              >
                <div className={`flex items-center justify-between px-0.5 text-xs ${isLight ? "text-slate-600" : "text-zinc-300"}`}>
                  <span className="font-semibold flex items-center space-x-1.5">
                    <Layers className="h-3.5 w-3.5" style={{ color: "var(--accent-text)" }} />
                    <span>多通道引擎对照结果 ({result.results.length})</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {result.results.map((res, idx) => (
                    <div
                      key={idx}
                      className={`animate-card-in p-3.5 rounded-xl border space-y-2 transition-all duration-150 hover:-translate-y-0.5 ${
                        isLight ? "text-slate-800" : "text-zinc-100"
                      }`}
                      style={{
                        background: "var(--g-surface-2)",
                        borderColor: "var(--g-hairline)",
                      }}
                    >
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span
                          className={`font-semibold px-2 py-0.5 rounded-md border text-[11px] truncate ${
                            isLight ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-blue-500/15 border-blue-400/30 text-sky-300"
                          }`}
                        >
                          {res.engineName}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(res.translated, idx)}
                          className="flex items-center space-x-1 px-2 py-1 rounded-md border text-[11px] transition cursor-pointer hover:bg-[var(--g-surface-3)] shrink-0"
                          style={{
                            background: "var(--g-surface)",
                            borderColor: "var(--g-hairline)",
                            color: "var(--g-text-2)",
                          }}
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
                      <p className={`text-sm font-medium leading-relaxed ${isLight ? "text-slate-800" : "text-zinc-100"}`}>
                        {res.translated}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 右侧可折叠「AI 语境副驾抽屉」 */}
          {result.wordDetail && isAiDrawerOpen && (
            <aside
              data-testid="search-ai-copilot-drawer"
              className="translator-pane animate-card-in w-full min-[780px]:w-[290px] lg:w-[325px] xl:w-[360px] shrink-0 rounded-2xl p-4 flex flex-col gap-3 min-[780px]:sticky min-[780px]:top-2"
            >
              <div className="flex items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: "var(--g-hairline)" }}>
                <div className="text-xs font-bold tracking-tight flex items-center space-x-1.5" style={{ color: "var(--accent-text)" }}>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AI 语境副驾抽屉</span>
                </div>
                {hasActiveLlm && (
                  <button
                    type="button"
                    onClick={() => loadAiContext(result.original, result.wordDetail!.definition, true)}
                    disabled={aiContextLoading}
                    className="flex items-center space-x-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition cursor-pointer hover:bg-[var(--g-surface-3)] disabled:opacity-50 shrink-0"
                    style={{
                      background: "var(--g-surface-2)",
                      borderColor: "var(--g-hairline)",
                      color: "var(--g-text-2)",
                    }}
                    title="重新请求大模型生成另一组例句与搭配"
                  >
                    <RotateCw className={`h-3 w-3 ${aiContextLoading ? "animate-spin text-blue-500" : ""}`} />
                    <span>{aiContextLoading ? "AI 生成中..." : "换一批"}</span>
                  </button>
                )}
              </div>

              {/* AI Loading Skeleton */}
              {aiContextLoading && (
                <div
                  className="p-3.5 rounded-xl border space-y-2.5"
                  style={{
                    background: "var(--g-surface-2)",
                    borderColor: "var(--accent-border)",
                  }}
                >
                  <div className="flex items-center space-x-2 text-xs font-medium" style={{ color: "var(--accent-text)" }}>
                    <Sparkles className="h-3.5 w-3.5 animate-spin" />
                    <span>AI 大模型正在提炼专业地道例句与场景搭配...</span>
                  </div>
                  <div className="space-y-2 pt-1">
                    <div className="liquid-shimmer-bar h-3 rounded-md w-4/5" />
                    <div className="liquid-shimmer-bar h-3 rounded-md w-3/5" />
                  </div>
                </div>
              )}

              {/* AI Context Card */}
              {!aiContextLoading && aiContext && aiContext.examples.length > 0 && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {aiContext.examples.map((ex, idx) => {
                      const copyKey = `ex_${idx}`;
                      const isCopied = copiedAiKey === copyKey;
                      return (
                        <div
                          key={idx}
                          className="group relative p-3 rounded-xl border transition"
                          style={{
                            background: "var(--g-surface-2)",
                            borderColor: "var(--g-hairline)",
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1 pr-1 flex-1 min-w-0">
                              <p className={`text-[13px] font-medium leading-relaxed font-sans ${isLight ? "text-slate-900" : "text-zinc-100"}`}>
                                {highlightQueryTerm(ex.en, result.original, result.wordDetail?.definition)}
                              </p>
                              <p className={`text-xs leading-relaxed ${isLight ? "text-slate-500" : "text-zinc-400"}`}>
                                {ex.zh}
                              </p>
                            </div>
                            <div className="flex items-center space-x-1 shrink-0 opacity-85 group-hover:opacity-100 transition">
                              <button
                                type="button"
                                onClick={() => speakText(ex.en, { lang: "en-US" })}
                                className="p-1 rounded-md border transition cursor-pointer hover:bg-[var(--g-surface-3)]"
                                style={{
                                  background: "var(--g-surface)",
                                  borderColor: "var(--g-hairline)",
                                  color: "var(--g-text-2)",
                                }}
                                title="朗读英文例句"
                              >
                                <Volume2 className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopyAiText(copyKey, `${ex.en}\n${ex.zh}`)}
                                className="p-1 rounded-md border transition cursor-pointer hover:bg-[var(--g-surface-3)]"
                                style={{
                                  background: "var(--g-surface)",
                                  borderColor: "var(--g-hairline)",
                                  color: "var(--g-text-2)",
                                }}
                                title="复制双语例句"
                              >
                                {isCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Collocations */}
                  {aiContext.collocations && aiContext.collocations.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className={`text-[11px] font-semibold uppercase tracking-wider flex items-center space-x-1 ${isLight ? "text-slate-500" : "text-zinc-400"}`}>
                        <Tag className="h-3 w-3" />
                        <span>常用搭配 / 场景短语（点击即查）</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {aiContext.collocations.map((col, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSearch(col.phrase)}
                            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs transition cursor-pointer active:scale-95 hover:bg-[var(--g-surface-3)]"
                            style={{
                              background: "var(--g-surface-2)",
                              borderColor: "var(--g-hairline)",
                              color: "var(--g-text-1)",
                            }}
                            title={`查询短语: ${col.phrase}`}
                          >
                            <span className="font-medium">{col.phrase}</span>
                            <span className={`text-[11px] opacity-75 border-l pl-1.5 ${isLight ? "border-slate-300" : "border-white/15"}`}>
                              {col.trans}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Usage Tip */}
                  {aiContext.usageTip && (
                    <div
                      className={`p-3 rounded-xl border flex items-start space-x-2 text-xs leading-relaxed ${
                        isLight ? "bg-amber-50/70 border-amber-200/80 text-amber-900" : "bg-amber-500/[0.08] border-amber-400/20 text-amber-200"
                      }`}
                    >
                      <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="space-y-0.5 flex-1">
                        <span className="font-semibold text-amber-600 dark:text-amber-400">语境辨析与用法提示：</span>
                        <span>{aiContext.usageTip}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Fallback Local Sentences */}
              {!aiContextLoading && !aiContext && result.wordDetail.examples.length > 0 && (
                <div className="space-y-2">
                  {result.wordDetail.examples.map((ex, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border text-xs leading-relaxed"
                      style={{
                        background: "var(--g-surface-2)",
                        borderColor: "var(--g-hairline)",
                        color: "var(--g-text-2)",
                      }}
                    >
                      <p className={`font-mono ${isLight ? "text-slate-900" : "text-zinc-200"}`}>{ex}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Unconfigured LLM Banner Guide */}
              {!aiContextLoading && !aiContext && !hasActiveLlm && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className={`w-full p-3 rounded-xl border flex items-center justify-between gap-2 text-xs transition cursor-pointer group text-left ${
                    isLight
                      ? "bg-gradient-to-r from-blue-50/70 to-indigo-50/70 border-blue-200 hover:border-blue-400 text-blue-800 shadow-xs"
                      : "bg-gradient-to-r from-blue-500/[0.08] to-indigo-500/[0.08] border-blue-400/20 hover:border-blue-400/40 text-sky-300 shadow-sm"
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <Sparkles className="h-3.5 w-3.5 text-blue-500 dark:text-sky-400 shrink-0" />
                    <span className="font-medium leading-relaxed">连接 AI 大模型，即可自动解锁专业地道例句、高频短语搭配与深度语境辨析</span>
                  </div>
                  <div className="flex items-center space-x-1 font-semibold group-hover:translate-x-0.5 transition-transform text-blue-600 dark:text-sky-300 shrink-0">
                    <span>去配置</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </button>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
};
