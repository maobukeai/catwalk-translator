import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Languages,
  ArrowRightLeft,
  Copy,
  Check,
  Volume2,
  X,
  Clipboard,
  RotateCcw,
  Layers,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cmdUniversalTranslate, detectLanguage, saveTranslationHistory } from "../../services/tauri";
import type {
  AppSettings,
  LanguageCode,
  LanguageOption,
  UniversalTranslationResponse,
} from "../../services/types";
import { LanguageDropdown } from "./LanguageDropdown";

interface DualPaneTranslatorProps {
  settings: AppSettings;
  initialText?: string;
}

const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "auto", name: "自动检测语种" },
  { code: "en", name: "英语 (English)" },
  { code: "zh-CN", name: "简体中文 (Chinese)" },
  { code: "ja", name: "日语 (日本語)" },
  { code: "ko", name: "韩语 (한국어)" },
  { code: "fr", name: "法语 (Français)" },
  { code: "de", name: "德语 (Deutsch)" },
  { code: "es", name: "西班牙语 (Español)" },
  { code: "ru", name: "俄语 (Русский)" },
];

function getShortEngineName(fullName: string): string {
  if (!fullName) return '';
  if (fullName.includes('Google') || fullName.includes('谷歌')) return '🌐 Google';
  if (fullName.includes('Bing') || fullName.includes('微软')) return '🔷 Bing';
  if (fullName.includes('有道')) return '🔴 有道';
  if (fullName.includes('Baidu') || fullName.includes('百度')) return '🐾 百度';
  if (fullName.includes('MyMemory')) return '🧠 MyMemory';
  if (fullName.includes('DeepL')) return '⚡ DeepL';
  if (fullName.includes('腾讯') || fullName.includes('Transmart')) return '🐧 腾讯';
  if (fullName.includes('AI') || fullName.includes('LLM')) {
    const match = fullName.match(/\((.*?)\)/);
    const provider = match ? match[1] : 'AI';
    return `🤖 ${provider}`;
  }
  if (fullName.includes('词库') || fullName.includes('Preset')) return '🧊 CG 词库';
  return fullName.replace(/（.*?）|\(.*?\)/g, '').trim();
}

export const DualPaneTranslator: React.FC<DualPaneTranslatorProps> = ({
  settings,
  initialText = "",
}) => {
  const [sourceText, setSourceText] = useState(initialText);
  const [sourceLang, setSourceLang] = useState<LanguageCode>("auto");
  const [targetLang, setTargetLang] = useState<LanguageCode>("zh-CN");
  const [detectedLangName, setDetectedLangName] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<UniversalTranslationResponse | null>(null);
  const [selectedEngineIndex, setSelectedEngineIndex] = useState<number>(0); // 0 default (AI model translation first)

  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tab row scroll refs & helpers
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  const updateScrollState = useCallback(() => {
    if (!tabsRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = tabsRef.current;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 2);
  }, []);

  useEffect(() => {
    updateScrollState();
    window.addEventListener("resize", updateScrollState);
    return () => window.removeEventListener("resize", updateScrollState);
  }, [response, updateScrollState]);

  // Native non-passive wheel event listener to prevent vertical page scroll
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        e.stopPropagation();
        el.scrollLeft += e.deltaY * 0.85;
        updateScrollState();
      }
    };

    el.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleNativeWheel);
    };
  }, [updateScrollState]);

  const handleTabsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!tabsRef.current) return;
    if (e.deltaY !== 0) {
      tabsRef.current.scrollLeft += e.deltaY;
      updateScrollState();
    }
  };

  const handleScrollByAmount = (amount: number) => {
    if (!tabsRef.current) return;
    tabsRef.current.scrollBy({ left: amount, behavior: "smooth" });
    setTimeout(updateScrollState, 200);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tabsRef.current) return;
    isDraggingRef.current = true;
    startXRef.current = e.pageX - tabsRef.current.offsetLeft;
    scrollLeftRef.current = tabsRef.current.scrollLeft;
  };

  const handleMouseLeaveOrUp = () => {
    isDraggingRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !tabsRef.current) return;
    e.preventDefault();
    const x = e.pageX - tabsRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.5;
    tabsRef.current.scrollLeft = scrollLeftRef.current - walk;
    updateScrollState();
  };

  // Execute translation
  const performTranslation = useCallback(
    async (text: string, src: LanguageCode, tgt: LanguageCode) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setResponse(null);
        setLoading(false);
        setDetectedLangName("");
        return;
      }

      setLoading(true);
      try {
        const res = await cmdUniversalTranslate({
          text: trimmed,
          sourceLang: src,
          targetLang: tgt,
          preset: settings.defaultPreset,
          llmConfig: settings.llmConfig,
          presetDicts: settings.presetDicts,
          onlineEngines: settings.onlineEngines,
          translationTiers: settings.translationTiers,
        });

        setResponse(res);
        setSelectedEngineIndex(0);

        // 持久化到生词本/历史记录（按原文去重）
        if (res.mainTranslation) {
          const tier = res.engines[0]?.sourceTier || 'Online Fallback';
          saveTranslationHistory(trimmed, res.mainTranslation, tier).catch((e) =>
            console.warn('History save failed:', e)
          );
        }

        // Update detected language tag
        if (src === "auto") {
          const match = SUPPORTED_LANGUAGES.find((l) => l.code === res.detectedLang);
          setDetectedLangName(match ? match.name.split(" ")[0] : res.detectedLang);
        } else {
          setDetectedLangName("");
        }
      } catch (err) {
        console.error("Translation error:", err);
      } finally {
        setLoading(false);
      }
    },
    [settings.defaultPreset, settings.llmConfig, settings.presetDicts, settings.onlineEngines, settings.translationTiers]
  );

  // Live input debounce listener
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!sourceText.trim()) {
      setResponse(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceTimerRef.current = setTimeout(() => {
      performTranslation(sourceText, sourceLang, targetLang);
    }, 350);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [sourceText, sourceLang, targetLang, performTranslation]);

  // Swap source & target languages
  const handleSwapLanguages = () => {
    if (sourceLang === "auto") {
      const { detected } = detectLanguage(sourceText);
      setSourceLang(targetLang);
      setTargetLang(detected);
    } else {
      const prevSrc = sourceLang;
      setSourceLang(targetLang);
      setTargetLang(prevSrc);
    }

    if (response?.mainTranslation) {
      setSourceText(response.mainTranslation);
    }
  };

  // Paste from clipboard
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setSourceText(text);
    } catch (err) {
      console.warn("Paste error:", err);
    }
  };

  // Copy translated text
  const handleCopy = (textToCopy: string) => {
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Select engine from comparison card, update top pane & auto scroll tab bar
  const handleSelectEngineCard = (idx: number, text: string) => {
    setSelectedEngineIndex(idx);
    handleCopy(text);

    if (tabsRef.current) {
      const targetBtn = tabsRef.current.children[idx] as HTMLElement;
      if (targetBtn) {
        targetBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  };

  // Text to Speech
  const handleSpeech = (text: string, lang: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "zh-CN" ? "zh-CN" : lang === "ja" ? "ja-JP" : "en-US";
    utterance.rate = 0.95;
    setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  // Display translation based on selected engine (defaults to index 0: AI translation)
  const currentTranslationText =
    response?.engines[selectedEngineIndex]?.translated || response?.mainTranslation || "";

  const activeTheme = settings.appearance?.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  return (
    <div className="space-y-4 max-w-5xl mx-auto font-sans">
      {/* Top Language Bar */}
      <div className={`relative z-30 flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-2xl border transition-colors ${
        isLight
          ? 'bg-white/90 border-slate-200 shadow-sm text-slate-800'
          : 'bg-white/[0.04] border-white/10 backdrop-blur-md text-zinc-100'
      }`}>
        {/* Source Language Selector */}
        <LanguageDropdown
          label="源语言"
          value={sourceLang}
          options={SUPPORTED_LANGUAGES}
          onChange={setSourceLang}
          detectedName={detectedLangName}
          quickCodes={["auto", "en", "zh-CN", "ja"]}
        />

        {/* Swap Languages Button */}
        <button
          type="button"
          onClick={handleSwapLanguages}
          className={`flex items-center justify-center h-8 w-8 rounded-xl border transition shadow-xs cursor-pointer active:scale-95 ${
            isLight
              ? 'bg-slate-100 hover:bg-blue-600 hover:text-white border-slate-300 text-slate-700'
              : 'bg-zinc-800/80 hover:bg-blue-600 hover:text-white border-white/[0.08] text-zinc-300'
          }`}
          title="互换源语言与目标语言"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
        </button>

        {/* Target Language Selector */}
        <LanguageDropdown
          label="目标语言"
          value={targetLang}
          options={SUPPORTED_LANGUAGES.filter((l) => l.code !== "auto")}
          onChange={setTargetLang}
          quickCodes={["zh-CN", "en", "ja", "ko"]}
          align="right"
        />
      </div>

      {/* Main Dual-Pane Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Pane: Source Input */}
        <div className={`flex flex-col h-[340px] p-4 rounded-2xl border transition-all ${
          isLight
            ? 'bg-white border-slate-200 shadow-sm focus-within:border-blue-500'
            : 'bg-zinc-900/60 border-white/10 shadow-inner focus-within:border-blue-500/60'
        }`}>
          {/* Header toolbar */}
          <div className={`flex items-center justify-between pb-2 border-b text-xs ${
            isLight ? 'border-slate-200 text-slate-500' : 'border-zinc-800/60 text-zinc-400'
          }`}>
            <span className={`font-semibold ${isLight ? 'text-slate-800' : 'text-zinc-300'}`}>原文输入 (实时防抖翻译)</span>
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={handlePaste}
                className={`flex items-center space-x-1 px-2 py-1 rounded-md transition ${
                  isLight ? 'hover:bg-slate-100 text-slate-600 hover:text-slate-900' : 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
                title="粘贴剪贴板文本"
              >
                <Clipboard className="h-3.5 w-3.5" />
                <span>粘贴</span>
              </button>
              {sourceText && (
                <button
                  type="button"
                  onClick={() => setSourceText("")}
                  className={`flex items-center space-x-1 px-2 py-1 rounded-md transition ${
                    isLight ? 'hover:bg-slate-100 text-slate-600 hover:text-slate-900' : 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="清空内容"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>清空</span>
                </button>
              )}
            </div>
          </div>

          {/* Text Area */}
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="输入或粘贴任意英文、中文段落，或 CG 软件专业名词..."
            className={`flex-1 w-full bg-transparent resize-none py-3 text-base leading-relaxed focus:outline-none scrollbar-thin ${
              isLight
                ? 'text-slate-900 placeholder:text-slate-400'
                : 'text-zinc-100 placeholder:text-zinc-500'
            }`}
          />

          {/* Footer Bar */}
          <div className={`flex items-center justify-between pt-2 border-t text-xs ${
            isLight ? 'border-slate-200 text-slate-500' : 'border-zinc-800/60 text-zinc-500'
          }`}>
            <div className="flex items-center space-x-2">
              {sourceText && (
                <button
                  type="button"
                  onClick={() => handleSpeech(sourceText, sourceLang)}
                  className="hover:text-blue-500 transition"
                  title="朗读原文"
                >
                  <Volume2 className="h-4 w-4" />
                </button>
              )}
              <span>
                {sourceText.length} 字符 | {sourceText.trim() ? sourceText.trim().split(/\s+/).length : 0} 词
              </span>
            </div>

            {loading && (
              <div className="flex items-center space-x-1.5 text-blue-500 font-mono">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-ping" />
                <span>翻译中...</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Translation Output */}
        <div className={`flex flex-col h-[340px] p-4 relative rounded-2xl border transition-all ${
          isLight
            ? 'bg-white border-slate-200 shadow-sm'
            : 'bg-zinc-900/60 border-white/10 shadow-inner'
        }`}>
          {/* Engine Tabs Header */}
          <div className={`flex items-center justify-between pb-2 border-b text-xs ${
            isLight ? 'border-slate-200' : 'border-zinc-800/60'
          }`}>
            <div className="flex items-center space-x-1 flex-1 min-w-0 pr-2">
              {canScrollLeft && (
                <button
                  type="button"
                  onClick={() => handleScrollByAmount(-120)}
                  className={`p-1 rounded-md transition shrink-0 cursor-pointer ${
                    isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                  title="向左滚动引擎选项"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              )}

              <div
                ref={tabsRef}
                onWheel={handleTabsWheel}
                onScroll={updateScrollState}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeaveOrUp}
                onMouseUp={handleMouseLeaveOrUp}
                onMouseMove={handleMouseMove}
                className="flex items-center space-x-1.5 overflow-x-auto pr-1 flex-nowrap scrollbar-none select-none cursor-grab active:cursor-grabbing flex-1 min-w-0"
              >
                {response?.engines && response.engines.length > 0 ? (
                  response.engines.map((eng, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedEngineIndex(idx)}
                      title={eng.engineName}
                      className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer whitespace-nowrap shrink-0 ${
                        selectedEngineIndex === idx
                          ? "bg-blue-600 text-white shadow-sm font-bold"
                          : (isLight ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800")
                      }`}
                    >
                      {getShortEngineName(eng.engineName)}
                    </button>
                  ))
                ) : (
                  <>
                    <button
                      type="button"
                      className="px-2.5 py-1 rounded-md font-bold bg-blue-600 text-white shadow-sm whitespace-nowrap shrink-0"
                    >
                      🤖 AI 深度翻译
                    </button>
                    <button
                      type="button"
                      className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap shrink-0 ${
                        isLight ? "text-slate-600" : "text-zinc-400"
                      }`}
                    >
                      🌐 Google
                    </button>
                    <button
                      type="button"
                      className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap shrink-0 ${
                        isLight ? "text-slate-600" : "text-zinc-400"
                      }`}
                    >
                      🔷 Bing
                    </button>
                    <button
                      type="button"
                      className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap shrink-0 ${
                        isLight ? "text-slate-600" : "text-zinc-400"
                      }`}
                    >
                      🔴 有道
                    </button>
                  </>
                )}
              </div>

              {canScrollRight && (
                <button
                  type="button"
                  onClick={() => handleScrollByAmount(120)}
                  className={`p-1 rounded-md transition shrink-0 cursor-pointer ${
                    isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                  title="向右滚动引擎选项"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => performTranslation(sourceText, sourceLang, targetLang)}
              className={`p-1 rounded-md transition shrink-0 ${
                isLight ? 'hover:bg-slate-100 text-slate-500 hover:text-slate-800' : 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
              title="重新翻译"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Translation Result Output */}
          <div className="flex-1 w-full overflow-y-auto py-3 text-base leading-relaxed scrollbar-thin">
            {currentTranslationText ? (
              <p className={`font-medium whitespace-pre-wrap selection:bg-blue-600 selection:text-white ${
                isLight ? 'text-slate-900' : 'text-zinc-100'
              }`}>
                {currentTranslationText}
              </p>
            ) : (
              <div className={`h-full flex flex-col items-center justify-center text-center space-y-2 ${
                isLight ? 'text-slate-400' : 'text-zinc-500'
              }`}>
                <Languages className={`h-8 w-8 ${isLight ? 'text-slate-300' : 'text-zinc-600'}`} />
                <p className="text-sm">左侧输入或粘贴内容，右侧实时展现翻译结果</p>
                <p className={`text-xs ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>支持 Google、MyMemory、CG 离线词库与 AI 大模型多引擎</p>
              </div>
            )}
          </div>

          {/* Action Toolbar */}
          <div className={`flex items-center justify-between pt-2 border-t text-xs ${
            isLight ? 'border-slate-200' : 'border-zinc-800/60'
          }`}>
            <div className="flex items-center space-x-2">
              {currentTranslationText && (
                <>
                  <button
                    type="button"
                    onClick={() => handleSpeech(currentTranslationText, targetLang)}
                    className={`p-1.5 rounded-lg border transition cursor-pointer ${
                      isSpeaking
                        ? "bg-blue-600/30 border-blue-400 text-blue-600"
                        : (isLight ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700" : "bg-zinc-800/80 hover:bg-zinc-700 border-zinc-700 text-zinc-300")
                    }`}
                    title="朗读译文发音"
                  >
                    <Volume2 className={`h-4 w-4 ${isSpeaking ? "animate-pulse" : ""}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopy(currentTranslationText)}
                    className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium px-3 py-1.5 rounded-lg transition shadow-sm cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-300" />
                        <span>已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>复制译文</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>

            <div className="text-[11px] text-zinc-500">
              {response?.engines && response.engines.length > 0 && (
                <span>已汇聚 {response.engines.length} 个引擎对照结果</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Engine Side-by-Side Comparison Cards (When available) */}
      {response && response.engines.length > 1 && (
        <div className={`rounded-2xl p-4 space-y-3 border transition-colors ${
          isLight ? 'bg-white/90 border-slate-200 shadow-sm text-slate-800' : 'glass-panel text-zinc-100'
        }`}>
          <div className={`flex items-center justify-between text-xs font-bold border-b pb-2 ${
            isLight ? 'text-slate-800 border-slate-200' : 'text-zinc-300 border-zinc-800'
          }`}>
            <div className="flex items-center space-x-1.5">
              <Layers className="h-4 w-4 text-indigo-500" />
              <span>多源引擎并行对照 (Multi-Engine Comparison)</span>
            </div>
            <span className={`font-medium text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>点击任意卡片即可直接切换主视图并复制</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {response.engines.map((engine, idx) => {
              const isSelected = selectedEngineIndex === idx;
              return (
                <div
                  key={idx}
                  onClick={() => handleSelectEngineCard(idx, engine.translated)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer group flex flex-col justify-between ${
                    isSelected
                      ? (isLight ? 'bg-blue-50/90 border-blue-500 shadow-md ring-2 ring-blue-500/40' : 'bg-blue-950/40 border-blue-400 shadow-md ring-2 ring-blue-400/40')
                      : (isLight
                          ? 'bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-blue-300 shadow-xs'
                          : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/80')
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-500'
                          : (isLight ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-blue-500/10 text-blue-400 border-blue-500/20')
                      }`}>
                        {engine.engineName}
                      </span>
                      <span className={`text-[10px] font-mono ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>{engine.sourceTier}</span>
                    </div>
                    <p className={`text-xs font-semibold line-clamp-4 leading-relaxed transition ${
                      isSelected
                        ? (isLight ? 'text-blue-950 font-bold' : 'text-white font-bold')
                        : (isLight ? 'text-slate-800 group-hover:text-blue-600' : 'text-zinc-200 group-hover:text-white')
                    }`}>
                      {engine.translated}
                    </p>
                  </div>

                  <div className={`flex items-center justify-between pt-2 mt-2 border-t text-[10px] transition ${
                    isLight ? 'border-slate-200/80' : 'border-zinc-800/80'
                  }`}>
                    {isSelected ? (
                      <span className="text-blue-600 dark:text-blue-400 font-bold flex items-center space-x-1">
                        <Check className="h-3 w-3" />
                        <span>已置顶为主显示</span>
                      </span>
                    ) : (
                      <span className={isLight ? 'text-slate-400 group-hover:text-blue-600' : 'text-zinc-500 group-hover:text-zinc-300'}>
                        切换至该渠道 ➔
                      </span>
                    )}

                    <span className={`font-medium ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                      点击复制
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
