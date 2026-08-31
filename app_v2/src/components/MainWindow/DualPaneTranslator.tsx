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
  Globe,
  Hexagon,
  BookOpen,
  PawPrint,
  Brain,
  Zap,
  Bird,
  Bot,
  Snowflake,
  Sparkles,
  Pin,
  Image as ImageIcon,
  Settings,
  Flame,
  MessageSquare,
} from "lucide-react";
import { cmdUniversalTranslate, detectLanguage, saveTranslationHistory, cmdImageOcrTranslate, cmdOpenPin } from "../../services/tauri";
import { exportTranslationImage } from "../../services/exportImage";
import { speakText } from "../../services/tts";
import type { ImageTranslateResponse } from "../../services/tauri";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppTheme } from "../../hooks/useAppTheme";
import type {
  AppSettings,
  LanguageCode,
  LanguageOption,
  UniversalTranslationResponse,
} from "../../services/types";
import { LanguageDropdown } from "./LanguageDropdown";
import { TranslationStyleDropdown } from "./TranslationStyleDropdown";

/** 批量图片翻译队列中的单张图片条目 */
interface ImageQueueItem {
  id: string;
  name: string;
  dataUrl: string;
  result: ImageTranslateResponse | null;
  error: string | null;
}

interface DualPaneTranslatorProps {
  settings: AppSettings;
  initialText?: string;
  onOpenSettings?: () => void;
}

/** 引擎 → lucide 图标映射（取代旧 emoji 徽章，统一苹果极简视觉） */
function getEngineIcon(shortName: string): React.ElementType {
  const n = shortName || '';
  if (n.includes('Lingva')) return Globe;
  if (n.includes('Google')) return Globe;
  if (n.includes('Bing')) return Hexagon;
  if (n.includes('有道')) return BookOpen;
  if (n.includes('百度')) return PawPrint;
  if (n.includes('MyMemory')) return Brain;
  if (n.includes('DeepL')) return Zap;
  if (n.includes('腾讯')) return Bird;
  if (n.includes('彩云')) return Sparkles;
  if (n.includes('Papago')) return Bird;
  if (n.includes('Urban') || n.includes('俚语')) return MessageSquare;
  if (n.includes('火山')) return Flame;
  if (n.includes('Yandex')) return Globe;
  if (n.includes('CG') || n.includes('词库')) return Snowflake;
  if (n.includes('AI') || n.includes('LLM')) return Bot;
  return Sparkles;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "auto", name: "自动检测语种" },
  { code: "zh-CN", name: "简体中文 (Chinese)" },
  { code: "zh-TW", name: "繁体中文 (Chinese Traditional)" },
  { code: "en", name: "英语 (English)" },
  { code: "ja", name: "日语 (日本語)" },
  { code: "ko", name: "韩语 (한국어)" },
  { code: "fr", name: "法语 (Français)" },
  { code: "de", name: "德语 (Deutsch)" },
  { code: "es", name: "西班牙语 (Español)" },
  { code: "ru", name: "俄语 (Русский)" },
  { code: "it", name: "意大利语 (Italiano)" },
  { code: "pt", name: "葡萄牙语 (Português)" },
  { code: "nl", name: "荷兰语 (Nederlands)" },
  { code: "pl", name: "波兰语 (Polski)" },
  { code: "ar", name: "阿拉伯语 (العربية)" },
  { code: "th", name: "泰语 (ไทย)" },
  { code: "vi", name: "越南语 (Tiếng Việt)" },
  { code: "id", name: "印尼语 (Bahasa Indonesia)" },
  { code: "tr", name: "土耳其语 (Türkçe)" },
  { code: "hi", name: "印地语 (हिन्दी)" },
  { code: "uk", name: "乌克兰语 (Українська)" },
  { code: "sv", name: "瑞典语 (Svenska)" },
  { code: "cs", name: "捷克语 (Čeština)" },
  { code: "el", name: "希腊语 (Ελληνικά)" },
  { code: "he", name: "希伯来语 (עברי特)" },
  { code: "da", name: "丹麦语 (Dansk)" },
  { code: "fi", name: "芬兰语 (Suomi)" },
  { code: "no", name: "挪威语 (Norsk)" },
  { code: "hu", name: "匈牙利语 (Magyar)" },
  { code: "ro", name: "罗马尼亚语 (Română)" },
];

function getShortEngineName(fullName: string): string {
  if (!fullName) return '';
  if (fullName.includes('Lingva')) return 'Lingva';
  if (fullName.includes('Google') || fullName.includes('谷歌')) return 'Google';
  if (fullName.includes('Bing') || fullName.includes('微软')) return 'Bing';
  if (fullName.includes('有道')) return '有道';
  if (fullName.includes('Baidu') || fullName.includes('百度')) return '百度';
  if (fullName.includes('MyMemory')) return 'MyMemory';
  if (fullName.includes('DeepL')) return 'DeepL';
  if (fullName.includes('腾讯') || fullName.includes('Transmart')) return '腾讯';
  if (fullName.includes('彩云')) return '彩云';
  if (fullName.includes('Papago') || fullName.includes('Naver')) return 'Papago';
  if (fullName.includes('Urban') || fullName.includes('俚语')) return 'Urban 俚语';
  if (fullName.includes('火山')) return '火山翻译';
  if (fullName.includes('Yandex')) return 'Yandex';
  if (fullName.includes('AI') || fullName.includes('LLM')) {
    const match = fullName.match(/\((.*?)\)/);
    const provider = match ? match[1] : 'AI';
    return `${provider}`;
  }
  if (fullName.includes('词库') || fullName.includes('Preset')) return 'CG 词库';
  return fullName.replace(/（.*?）|\(.*?\)/g, '').trim();
}

function isCgTermSource(sourceTier?: string, engineName?: string): boolean {
  const s = `${sourceTier || ''} ${engineName || ''}`.toLowerCase();
  return (
    s.includes('preset') ||
    s.includes('custom_dict') ||
    s.includes('cg') ||
    s.includes('blender') ||
    s.includes('substance') ||
    s.includes('unity') ||
    s.includes('unreal') ||
    s.includes('maya') ||
    s.includes('houdini') ||
    s.includes('3d') ||
    s.includes('词库') ||
    s.includes('词典')
  );
}

function getCgSoftwareHint(original: string, translated: string): string {
  const term = (original || '').toLowerCase();
  if (term.includes('bsdf') || term.includes('principled')) {
    return 'Blender Shader Editor / 材质节点：基于物理属性的能量守恒 Principled BSDF 主着色器。';
  }
  if (term.includes('subsurface') || term.includes('sss')) {
    return '3D 节点材质：次表面散射，用于仿真玉石、皮肤、蜡质等半透明介质内部漫射。';
  }
  if (term.includes('roughness') || term.includes('rough')) {
    return '3D PBR 材质规范：粗糙度通道（0.0 镜面高光 ~ 1.0 漫反射）。';
  }
  if (term.includes('metallic') || term.includes('metalness')) {
    return '3D PBR 材质规范：金属度遮罩（非金属 0.0 ~ 导电金属 1.0）。';
  }
  if (term.includes('normal') || term.includes('bump')) {
    return '3D 视口与渲染：法线贴图 / 凹凸凹陷细节高阶着色计算。';
  }
  if (term.includes('ambient') || term.includes('occlusion') || term.includes('ao')) {
    return '3D 视口与烘焙：环境光遮蔽（AO），计算缝隙角落暗部遮挡。';
  }
  if (term.includes('albedo') || term.includes('diffuse')) {
    return '3D PBR 材质规范：基础物理原色 / 漫反射色彩贴图。';
  }
  if (term.includes('uv') || term.includes('unwrap')) {
    return '3D 建模与纹理：UV 展开 / 纹理坐标映射平面拆分。';
  }
  if (term.includes('bake') || term.includes('baking')) {
    return 'Substance / Blender 纹理烘焙：将高模细节与光照贴图渲染导出至低模贴图。';
  }
  return `通用 3D/CG 软件（Blender, Substance Painter, Maya, Unity）标准专业定名；英文 "${original || 'Term'}" 对应行业规范译名 "${translated || '译名'}"。`;
}

export const DualPaneTranslator: React.FC<DualPaneTranslatorProps> = ({
  settings,
  initialText = "",
  onOpenSettings,
}) => {
  const { setTranslationStyle } = useSettingsStore();
  const [sourceText, setSourceText] = useState(initialText);
  const [sourceLang, setSourceLang] = useState<LanguageCode>("auto");
  const [targetLang, setTargetLang] = useState<LanguageCode>("zh-CN");
  const [detectedLangName, setDetectedLangName] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<UniversalTranslationResponse | null>(null);
  const [selectedEngineIndex, setSelectedEngineIndex] = useState<number>(0);
  const [preferredEngine, setPreferredEngine] = useState<string>(() => {
    try {
      return localStorage.getItem('maobu_preferred_engine') || 'auto';
    } catch {
      return 'auto';
    }
  });
  const [retryingEngines, setRetryingEngines] = useState<Record<string, boolean>>({});

  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hoveredCgCardIndex, setHoveredCgCardIndex] = useState<number | null>(null);
  const [hoveredMainCg, setHoveredMainCg] = useState<boolean>(false);

  // 图片翻译（Ctrl+V 粘贴 / 拖拽图片文件触发，走本地 OCR + 多级翻译管线）
  // ── 批量图片翻译队列：粘贴 / 拖入多张图片，逐张排队识别翻译 ──
  const [imageItems, setImageItems] = useState<ImageQueueItem[]>([]);
  const [imageDragOver, setImageDragOver] = useState(false);
  const [imageCopied, setImageCopied] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 翻译请求序号：防止并发触发（切语言/交换/重译）时慢的旧请求覆盖新结果
  const translationSeqRef = useRef(0);

  // Tab row scroll refs & helpers
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
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

  const handleElasticScroll = (amount: number) => {
    if (!tabsRef.current) return;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const start = tabsRef.current.scrollLeft;
    const maxScroll = tabsRef.current.scrollWidth - tabsRef.current.clientWidth;
    const target = Math.max(0, Math.min(start + amount, maxScroll));
    const startTime = performance.now();
    const duration = 380;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4) * Math.cos(progress * Math.PI * 1.5);
      if (tabsRef.current) {
        tabsRef.current.scrollLeft = start + (target - start) * ease;
        updateScrollState();
      }
      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    };

    animFrameRef.current = requestAnimationFrame(step);
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

  // 单卡内联重试：携带 forcedEngine 单独重新请求该引擎更新该卡片
  const handleRetrySingleEngine = useCallback(
    async (engineName: string) => {
      const trimmed = sourceText.trim();
      if (!trimmed || retryingEngines[engineName]) return;

      setRetryingEngines((prev) => ({ ...prev, [engineName]: true }));
      try {
        const res = await cmdUniversalTranslate({
          text: trimmed,
          sourceLang,
          targetLang,
          preset: settings.defaultPreset,
          llmConfig: settings.llmConfig,
          presetDicts: settings.presetDicts,
          onlineEngines: settings.onlineEngines,
          translationTiers: settings.translationTiers,
          style: settings.translationStyle,
          forcedEngine: engineName,
          baiduAppId: settings.baiduAppId,
          baiduSecret: settings.baiduSecret,
          deeplApiKey: settings.deeplApiKey,
          deeplCustomUrl: settings.deeplCustomUrl,
        });

        const updatedEngine =
          res.engines.find(
            (e) =>
              e.engineName === engineName ||
              getShortEngineName(e.engineName) === getShortEngineName(engineName)
          ) || res.engines[0];

        if (updatedEngine) {
          setResponse((prev) => {
            if (!prev) return prev;
            const updatedList = prev.engines.map((eng) => {
              if (
                eng.engineName === engineName ||
                getShortEngineName(eng.engineName) === getShortEngineName(engineName)
              ) {
                return updatedEngine;
              }
              return eng;
            });

            let newMain = prev.mainTranslation;
            const isMainRetry =
              !newMain ||
              newMain.includes('点击重试') ||
              newMain.includes('网络连接超时');
            if (
              isMainRetry &&
              updatedEngine.sourceTier !== 'Online (Retry)' &&
              !updatedEngine.translated.includes('点击重试') &&
              !updatedEngine.translated.includes('网络连接超时')
            ) {
              newMain = updatedEngine.translated;
            }

            return {
              ...prev,
              mainTranslation: newMain,
              engines: updatedList,
            };
          });
        }
      } catch (err) {
        console.error(`Retry error for engine ${engineName}:`, err);
      } finally {
        setRetryingEngines((prev) => ({ ...prev, [engineName]: false }));
      }
    },
    [
      sourceText,
      sourceLang,
      targetLang,
      settings.defaultPreset,
      settings.llmConfig,
      settings.presetDicts,
      settings.onlineEngines,
      settings.translationTiers,
      settings.translationStyle,
      retryingEngines,
    ]
  );

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

      const seq = ++translationSeqRef.current;
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
          style: settings.translationStyle,
          baiduAppId: settings.baiduAppId,
          baiduSecret: settings.baiduSecret,
          deeplApiKey: settings.deeplApiKey,
          deeplCustomUrl: settings.deeplCustomUrl,
        });

        // 请求期间用户又触发了新翻译，丢弃本次过期结果
        if (seq !== translationSeqRef.current) return;

        setResponse(res);

        // 优先将选中 Tab 设定为用户固定的优先渠道（preferredEngine），若未固定或该渠道失败则智能优选首个有效引擎
        let targetIdx = -1;
        const currentPref = localStorage.getItem('maobu_preferred_engine') || preferredEngine;
        if (currentPref && currentPref !== 'auto') {
          targetIdx = res.engines.findIndex((e) => {
            const short = getShortEngineName(e.engineName).toLowerCase();
            return (
              short === currentPref.toLowerCase() &&
              e.sourceTier !== 'Online (Retry)' &&
              !e.translated.includes('点击重试') &&
              !e.translated.includes('网络连接超时')
            );
          });
        }

        if (targetIdx === -1) {
          targetIdx = res.engines.findIndex(
            (e) =>
              e.translated === res.mainTranslation &&
              e.sourceTier !== 'Online (Retry)' &&
              !e.translated.includes('点击重试')
          );
        }

        setSelectedEngineIndex(targetIdx >= 0 ? targetIdx : 0);

        if (res.mainTranslation && !res.mainTranslation.includes('点击重试')) {
          const tier = res.engines[0]?.sourceTier || 'Online Fallback';
          saveTranslationHistory(trimmed, res.mainTranslation, tier).catch((e) =>
            console.warn('History save failed:', e)
          );
        }

        if (src === "auto") {
          const match = SUPPORTED_LANGUAGES.find((l) => l.code === res.detectedLang);
          setDetectedLangName(match ? match.name.split(" ")[0] : res.detectedLang);
        } else {
          setDetectedLangName("");
        }
      } catch (err) {
        if (seq !== translationSeqRef.current) return;
        console.error("Translation error:", err);
      } finally {
        // 过期请求不得清掉新请求的 loading 状态
        if (seq === translationSeqRef.current) setLoading(false);
      }
    },
    [settings.defaultPreset, settings.llmConfig, settings.presetDicts, settings.onlineEngines, settings.translationTiers, settings.translationStyle]
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

  const handlePaste = async () => {
    try {
      // 剪贴板里是截图时直接走图片翻译（WebView2/Chromium 支持 clipboard.read）
      const clip = navigator.clipboard as Clipboard & {
        read?: () => Promise<ClipboardItem[]>;
      };
      if (clip && typeof clip.read === "function") {
        try {
          const items = await clip.read();
          for (const item of items) {
            const imgType = item.types.find((t) => t.startsWith("image/"));
            if (imgType) {
              const blob = await item.getType(imgType);
              await enqueueImages([new File([blob], "clipboard.png", { type: imgType })]);
              return;
            }
          }
        } catch {
          // read() 被拒或无图片内容 → 回退读取文本
        }
      }
      const text = await navigator.clipboard.readText();
      if (text) setSourceText(text);
    } catch (err) {
      console.warn("Paste error:", err);
    }
  };

  /** 翻译队列中的单张图片（结果与错误写回队列条目） */
  const translateImageItem = useCallback(
    async (item: ImageQueueItem) => {
      try {
        const base64 = item.dataUrl.split(",")[1] || "";
        const res = await cmdImageOcrTranslate(base64, settings.defaultPreset, settings.llmConfig);
        setImageItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  result: res,
                  error: res.blocks.length ? null : "未在图片中识别到文本，请尝试更清晰的截图",
                }
              : it
          )
        );
      } catch (err) {
        setImageItems((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, error: err instanceof Error ? err.message : String(err) } : it
          )
        );
      }
    },
    [settings.defaultPreset, settings.llmConfig]
  );

  /** 批量入口：多张图片全部入队后逐张顺序翻译（避免并发打爆 OCR / 配额） */
  const enqueueImages = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) return false;
      const newItems: ImageQueueItem[] = [];
      for (const file of imgs) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        newItems.push({
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name || "剪贴板图片",
          dataUrl,
          result: null,
          error: null,
        });
      }
      setImageItems((prev) => [...prev, ...newItems]);
      for (const item of newItems) {
        await translateImageItem(item);
      }
      return true;
    },
    [translateImageItem]
  );

  const removeImageItem = (id: string) => {
    setImageItems((prev) => prev.filter((it) => it.id !== id));
  };

  const retryImageItem = (id: string) => {
    const item = imageItems.find((it) => it.id === id);
    if (!item) return;
    setImageItems((prev) => prev.map((it) => (it.id === id ? { ...it, error: null, result: null } : it)));
    void translateImageItem(item);
  };

  const handleCopyAllImage = () => {
    const all = imageItems
      .map((it) => (it.result?.blocks || []).map((b) => b.translated || b.original).filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n\n");
    if (!all) return;
    navigator.clipboard.writeText(all);
    setImageCopied(true);
    setTimeout(() => setImageCopied(false), 2000);
  };

  const closeImagePanel = () => setImageItems([]);

  /** 把当前译文贴图到桌面（独立置顶小窗） */
  const handlePinTranslation = () => {
    if (!currentTranslationText) return;
    void cmdOpenPin({
      id: `pin_${Date.now()}`,
      title: "翻译结果",
      blocks: [
        {
          original: sourceText.slice(0, 500),
          translated: currentTranslationText,
          sourceTier: currentEngine?.sourceTier || "多引擎",
        },
      ],
      x: Math.max(8, (typeof window !== "undefined" ? window.screenX : 0) + 120),
      y: Math.max(8, (typeof window !== "undefined" ? window.screenY : 0) + 160),
      width: 380,
      height: 210,
    }).catch((e) => console.warn("贴图失败:", e));
  };

  /** 把当前原文+译文渲染成分享卡片 PNG 并保存到图片库 */
  const handleExportImage = async () => {
    if (!currentTranslationText) return;
    setExportingImage(true);
    try {
      await exportTranslationImage({
        title: "翻译结果",
        lines: [{ original: sourceText.slice(0, 400), translated: currentTranslationText }],
      });
    } catch (e) {
      console.warn("导出图片失败:", e);
    } finally {
      setExportingImage(false);
    }
  };

  // 拦截原生粘贴：剪贴板里是图片时走 OCR 翻译，是文本时保持默认行为落入输入框
  const handleNativePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void enqueueImages([file]);
            return;
          }
        }
      }
    },
    [enqueueImages]
  );

  const handleNativeDrop = useCallback(
    (e: React.DragEvent) => {
      setImageDragOver(false);
      const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void enqueueImages(files);
      }
    },
    [enqueueImages]
  );

  const handleCopy = (textToCopy: string) => {
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  const handleSpeech = (text: string, lang: string) => {
    if (!text) return;
    setIsSpeaking(true);
    speakText(text, {
      lang: lang === "zh-CN" ? "zh-CN" : lang === "ja" ? "ja-JP" : "en-US",
      onEnd: () => setIsSpeaking(false),
    });
  };

  const currentEngine = response?.engines[selectedEngineIndex];
  const currentTranslationText = currentEngine?.translated || response?.mainTranslation || "";
  const isCurrentCgTerm = isCgTermSource(currentEngine?.sourceTier, currentEngine?.engineName);

  const enabledPlaceholderTabs = React.useMemo(() => {
    const tabs: { name: string; icon: React.ElementType }[] = [];
    const isLlmConfigured = !!settings.llmConfig && (
      (settings.llmConfig.endpoint?.includes('localhost') || settings.llmConfig.endpoint?.includes('127.0.0.1')) ||
      !!settings.llmConfig.apiKey?.trim()
    );
    if (isLlmConfigured) {
      const provider = settings.llmConfig?.provider || 'AI';
      tabs.push({ name: `${provider} 深度翻译`, icon: Bot });
    }
    const dicts = settings.presetDicts;
    if (dicts && Object.values(dicts).some(Boolean)) {
      tabs.push({ name: 'CG 词库', icon: Snowflake });
    }
    const online = settings.onlineEngines;
    if (online?.bing) tabs.push({ name: 'Bing', icon: Hexagon });
    if (online?.youdao) tabs.push({ name: '有道', icon: BookOpen });
    if (online?.tencent) tabs.push({ name: '腾讯', icon: Bird });
    if (online?.caiyun) tabs.push({ name: '彩云', icon: Sparkles });
    if (online?.lingva) tabs.push({ name: 'Lingva', icon: Globe });
    if (online?.papago) tabs.push({ name: 'Papago', icon: Bird });
    if (online?.volcengine) tabs.push({ name: '火山翻译', icon: Flame });
    if (online?.urban) tabs.push({ name: 'Urban 俚语', icon: MessageSquare });
    if (online?.yandex) tabs.push({ name: 'Yandex', icon: Globe });
    if (online?.google) tabs.push({ name: 'Google', icon: Globe });
    if (online?.deepl && (settings.deeplApiKey?.trim() || settings.deeplCustomUrl?.trim())) {
      tabs.push({ name: 'DeepL', icon: Zap });
    }
    if (online?.baidu && settings.baiduAppId?.trim() && settings.baiduSecret?.trim()) {
      tabs.push({ name: '百度', icon: PawPrint });
    }
    if (online?.myMemory) tabs.push({ name: 'MyMemory', icon: Brain });
    if (tabs.length === 0) {
      tabs.push({ name: 'Bing', icon: Hexagon });
    }
    return tabs;
  }, [
    settings.llmConfig,
    settings.presetDicts,
    settings.onlineEngines,
    settings.deeplApiKey,
    settings.deeplCustomUrl,
    settings.baiduAppId,
    settings.baiduSecret,
  ]);

  const { isLight } = useAppTheme();

  const renderCgPopoverTooltip = (
    original: string,
    translated: string,
    sourceTier: string,
    cgDomainNote?: string
  ) => (
    <div
      role="tooltip"
      aria-label="CG 专有名词释义浮层"
      className="absolute z-50 bottom-full mb-2.5 left-1/2 -translate-x-1/2 w-72 p-3.5 rounded-xl shadow-2xl border backdrop-blur-xl animate-in fade-in zoom-in-95 transition-all text-left pointer-events-none bg-slate-900/95 border-sky-400/40 text-zinc-100 ring-1 ring-sky-400/30"
    >
      <div className="flex items-center justify-between border-b border-zinc-700/80 pb-2 mb-2">
        <span className="flex items-center space-x-1.5 font-bold text-xs text-sky-400">
          <Snowflake className="h-3.5 w-3.5" />
          <span>CG 专有名词释义</span>
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/30 font-mono font-semibold">
          {sourceTier || '3D 词库'}
        </span>
      </div>
      <div className="space-y-2 text-xs">
        <div>
          <span className="text-[11px] font-semibold text-zinc-400 block mb-0.5">英文原词：</span>
          <p className="font-mono text-white font-bold bg-zinc-800/60 px-2 py-1 rounded border border-white/5 break-words">
            {original}
          </p>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-zinc-400 block mb-0.5">中文标准定名：</span>
          <p className="text-sky-300 font-bold bg-sky-950/40 px-2 py-1 rounded border border-sky-500/20 break-words">
            {translated}
          </p>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-zinc-400 block mb-0.5">3D 软件应用提示：</span>
          <p className="text-zinc-200 text-[11px] leading-relaxed bg-zinc-800/80 p-2 rounded border border-white/10">
            {cgDomainNote || getCgSoftwareHint(original, translated)}
          </p>
        </div>
      </div>
      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-4 border-transparent border-t-slate-900" />
    </div>
  );

  return (
    <div
      className={`space-y-4 max-w-5xl mx-auto font-sans rounded-3xl transition-shadow ${
        imageDragOver ? "ring-2 ring-sky-400 ring-offset-4 ring-offset-transparent shadow-lg" : ""
      }`}
      onPaste={handleNativePaste}
      onDrop={handleNativeDrop}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          setImageDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setImageDragOver(false);
      }}
    >
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
            isLight
              ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 shadow-xs'
              : 'bg-white/[0.06] border-white/10 text-sky-400 shadow-inner backdrop-blur-md'
          }`}>
            <Languages className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className={`text-base font-bold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>文本翻译</h1>
            <p className={`text-xs ${isLight ? 'text-slate-500 font-medium' : 'text-zinc-400'}`}>
              多引擎对照 · 3D/CG 专业词库 · 支持粘贴 / 拖入多张图片批量翻译
            </p>
          </div>
        </div>
        <span className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full border ${
          isLight ? 'bg-slate-100/90 border-slate-200 text-slate-600' : 'bg-white/[0.04] border-white/[0.08] text-zinc-300'
        }`}>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          实时防抖 · 输入即译
        </span>
      </div>

      {/* 图片翻译结果面板（粘贴 / 拖入多张图片，批量排队翻译） */}
      {imageItems.length > 0 && (
        <div className={`relative p-4 rounded-2xl border transition-colors ${
          isLight ? 'bg-white/90 border-slate-200 shadow-sm' : 'bg-white/[0.04] border-white/10 backdrop-blur-md'
        }`} data-testid="image-translate-panel">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon className="h-4 w-4 text-sky-500 shrink-0" />
              <span className={`text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>图片翻译</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-400/30 shrink-0">
                {imageItems.length} 张 · 共 {imageItems.reduce((n, it) => n + (it.result?.blocks.length || 0), 0)} 行
              </span>
              {imageItems.some((it) => !it.result && !it.error) && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-400/30 shrink-0 animate-pulse">
                  翻译中…
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {imageItems.some((it) => (it.result?.blocks || []).length > 0) && (
                <button
                  type="button"
                  onClick={handleCopyAllImage}
                  className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition cursor-pointer shrink-0 ${
                    isLight
                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-300'
                      : 'bg-white/5 hover:bg-white/10 text-zinc-300 border-white/10'
                  }`}
                  title="复制全部图片的译文"
                >
                  {imageCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  <span>{imageCopied ? '已复制' : '复制全部'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={closeImagePanel}
                className={`p-1.5 rounded-lg transition cursor-pointer shrink-0 ${
                  isLight ? 'text-slate-400 hover:text-rose-500 hover:bg-slate-100' : 'text-zinc-500 hover:text-rose-400 hover:bg-white/5'
                }`}
                title="关闭图片翻译"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {imageItems.map((item) => {
              const itemBusy = !item.result && !item.error;
              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-2.5 ${isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-white/[0.02] border-white/[0.06]'}`}
                  data-testid="image-queue-item"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[11px] font-semibold truncate ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
                        {item.name}
                      </span>
                      {item.result && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-500 border border-sky-400/20 shrink-0">
                          {item.result.blocks.length} 行 · {item.result.imageWidth}×{item.result.imageHeight}
                        </span>
                      )}
                      {itemBusy && (
                        <span className="text-[9px] font-mono text-amber-500 shrink-0 animate-pulse">识别中…</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.error && (
                        <button
                          type="button"
                          onClick={() => retryImageItem(item.id)}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border border-amber-400/40 text-amber-500 hover:bg-amber-500/20 transition cursor-pointer"
                          title="重试此图片"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>重试</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImageItem(item.id)}
                        className={`p-1 rounded-md transition cursor-pointer ${
                          isLight ? 'text-slate-400 hover:text-rose-500 hover:bg-slate-100' : 'text-zinc-500 hover:text-rose-400 hover:bg-white/5'
                        }`}
                        title="从队列移除此图片"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {item.error && (
                    <div className="mb-2 flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-500">
                      <span className="min-w-0 truncate">{item.error}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {/* 左：原图 + 识别区块原位叠加译文 */}
                    <div className={`relative overflow-hidden rounded-xl border ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
                      <img src={item.dataUrl} alt={item.name} className="w-full h-auto block" draggable={false} />
                      {(item.result?.blocks || []).map((b, bi) => {
                        const sx = item.result ? 100 / item.result.imageWidth : 0;
                        const sy = item.result ? 100 / item.result.imageHeight : 0;
                        return (
                          <div
                            key={bi}
                            className="absolute overflow-hidden rounded-sm border border-sky-400/60"
                            style={{
                              left: `${b.x * sx}%`,
                              top: `${b.y * sy}%`,
                              width: `${b.width * sx}%`,
                              height: `${b.height * sy}%`,
                              background: b.bgCss,
                              color: b.fgCss,
                            }}
                            title={`${b.original} → ${b.translated}`}
                          >
                            <span className="block px-1 truncate" style={{ fontSize: 'clamp(8px, 1.4vh, 13px)', lineHeight: 1.2 }}>
                              {b.translated || b.original}
                            </span>
                          </div>
                        );
                      })}
                      {itemBusy && (
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
                          <span className="text-xs text-white font-mono animate-pulse">识别中…</span>
                        </div>
                      )}
                    </div>

                    {/* 右：行级对照列表 */}
                    <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                      {itemBusy && (
                        <div className="space-y-1.5">
                          {[0, 1, 2].map((k) => (
                            <div key={k} className={`h-9 rounded-lg animate-pulse ${isLight ? 'bg-slate-100' : 'bg-white/5'}`} />
                          ))}
                        </div>
                      )}
                      {(item.result?.blocks || []).map((b, bi) => (
                        <div
                          key={bi}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                            isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.03] border-white/[0.06]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`font-mono truncate ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>{b.original}</span>
                            <span className="text-[9px] font-mono shrink-0 opacity-70">{(b.confidence * 100).toFixed(0)}%</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <span className={`font-bold truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>{b.translated}</span>
                            <span className="text-[9px] font-mono shrink-0 px-1.5 rounded bg-sky-500/15 text-sky-400 border border-sky-400/25">
                              {b.sourceTier}
                            </span>
                          </div>
                        </div>
                      ))}
                      {item.result && !item.result.blocks.length && !item.error && (
                        <p className={`text-xs ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>未识别到文本行</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Language Bar */}
      <div className={`relative z-30 flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-2xl border transition-colors ${
        isLight
          ? 'bg-white/90 border-slate-200 shadow-sm text-slate-800'
          : 'bg-white/[0.04] border-white/10 backdrop-blur-md text-zinc-100'
      }`}>
        <LanguageDropdown
          label="源语言"
          value={sourceLang}
          options={SUPPORTED_LANGUAGES}
          onChange={setSourceLang}
          detectedName={detectedLangName}
          quickCodes={["auto", "en", "zh-CN", "ja"]}
        />

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

        {/* 译文风格：LLM 翻译的直译 / 流畅 / 术语优先 */}
        <TranslationStyleDropdown
          value={settings.translationStyle || 'free'}
          onChange={setTranslationStyle}
        />

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
        <div className={`flex flex-col h-[clamp(300px,44vh,440px)] p-4 rounded-2xl border transition-all ${
          isLight
            ? 'bg-white/70 border-white/80 shadow-md backdrop-blur-md shadow-slate-900/5 focus-within:border-sky-500/50'
            : 'bg-white/[0.04] border-white/10 shadow-lg backdrop-blur-md shadow-black/20 focus-within:border-sky-400/40'
        }`}
        style={{
          boxShadow: isLight ? 'var(--g-inset-top), var(--g-shadow-soft)' : 'var(--g-inset-top), var(--g-shadow-soft)',
        }}>
          <div className={`flex items-center justify-between pb-2 border-b text-xs ${
            isLight ? 'border-black/5 text-slate-700' : 'border-white/5 text-zinc-300'
          }`}>
            <span className={`font-semibold ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>原文输入 (实时防抖翻译)</span>
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={handlePaste}
                className={`flex items-center space-x-1 px-2 py-1 rounded-md transition ${
                  isLight ? 'hover:bg-black/5 text-slate-700 hover:text-slate-900' : 'hover:bg-white/10 text-zinc-300 hover:text-zinc-100'
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
                    isLight ? 'hover:bg-black/5 text-slate-700 hover:text-slate-900' : 'hover:bg-white/10 text-zinc-300 hover:text-zinc-100'
                  }`}
                  title="清空内容"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>清空</span>
                </button>
              )}
            </div>
          </div>

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

          <div className={`flex items-center justify-between pt-2 border-t text-xs ${
            isLight ? 'border-black/5 text-slate-700' : 'border-white/5 text-zinc-400'
          }`}>
            <div className="flex items-center space-x-2">
              {sourceText && (
                <button
                  type="button"
                  onClick={() => handleSpeech(sourceText, sourceLang)}
                  className="hover:text-sky-500 transition"
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
              <div className="flex items-center space-x-1.5 text-sky-500 font-mono">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-500 animate-ping" />
                <span>翻译中...</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Translation Output */}
        <div className={`flex flex-col h-[clamp(300px,44vh,440px)] p-4 relative rounded-2xl border transition-all ${
          isLight
            ? 'bg-white/70 border-white/80 shadow-md backdrop-blur-md shadow-slate-900/5'
            : 'bg-white/[0.04] border-white/10 shadow-lg backdrop-blur-md shadow-black/20'
        }`}
        style={{
          boxShadow: isLight ? 'var(--g-inset-top), var(--g-shadow-soft)' : 'var(--g-inset-top), var(--g-shadow-soft)',
        }}>
          <div className={`flex items-center justify-between pb-2 border-b text-xs ${
            isLight ? 'border-black/5' : 'border-white/5'
          }`}>
            <div className="relative flex items-center flex-1 min-w-0 pr-2">
              <div
                ref={tabsRef}
                onWheel={handleTabsWheel}
                onScroll={updateScrollState}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeaveOrUp}
                onMouseUp={handleMouseLeaveOrUp}
                onMouseMove={handleMouseMove}
                className="flex items-center space-x-1.5 overflow-x-auto pr-1 flex-nowrap scrollbar-none select-none cursor-grab active:cursor-grabbing flex-1 min-w-0 py-0.5"
              >
                {/* 智能优选 切换标签 */}
                <button
                  type="button"
                  onClick={() => {
                    setPreferredEngine('auto');
                    try { localStorage.setItem('maobu_preferred_engine', 'auto'); } catch {}
                    if (response?.engines) {
                      const validIdx = response.engines.findIndex(
                        (e) =>
                          e.translated === response.mainTranslation &&
                          e.sourceTier !== 'Online (Retry)' &&
                          !e.translated.includes('点击重试')
                      );
                      setSelectedEngineIndex(validIdx >= 0 ? validIdx : 0);
                    }
                  }}
                  title="智能多级自动择优推荐 (点击清除固定渠道)"
                  className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                    preferredEngine === 'auto'
                      ? "text-white shadow-sm font-bold"
                      : (isLight ? "text-slate-600 hover:text-slate-950 hover:bg-slate-200/80" : "text-zinc-300 hover:text-white hover:bg-white/10")
                  }`}
                  style={preferredEngine === 'auto' ? { background: 'var(--accent)' } : undefined}
                >
                  <Sparkles className={`h-3.5 w-3.5 ${preferredEngine === 'auto' ? 'text-white' : 'opacity-70'}`} />
                  <span>智能推荐</span>
                </button>

                {response?.engines && response.engines.length > 0 ? (
                  response.engines.map((eng, idx) => {
                    const isCg = isCgTermSource(eng.sourceTier, eng.engineName);
                    const isRetry =
                      eng.sourceTier === 'Online (Retry)' ||
                      eng.translated.includes('点击重试') ||
                      eng.translated.includes('网络连接超时');
                    const shortName = getShortEngineName(eng.engineName);
                    const EngineIcon = getEngineIcon(shortName);
                    const isPreferred = preferredEngine.toLowerCase() === shortName.toLowerCase();
                    const isSelected = selectedEngineIndex === idx && preferredEngine !== 'auto';
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setSelectedEngineIndex(idx);
                          setPreferredEngine(shortName);
                          try {
                            localStorage.setItem('maobu_preferred_engine', shortName);
                          } catch {}
                        }}
                        title={`${eng.engineName} - 点击固定为此渠道优先显示`}
                        className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                          isSelected
                            ? "text-white shadow-sm font-bold"
                            : (isLight ? "text-slate-600 hover:text-slate-950 hover:bg-slate-200/80" : "text-zinc-300 hover:text-white hover:bg-white/10")
                        }`}
                        style={isSelected ? { background: isRetry ? '#d97706' : 'var(--accent)' } : undefined}
                      >
                        <EngineIcon className={`h-3.5 w-3.5 ${isRetry ? 'text-amber-300' : isCg ? 'text-cyan-300' : (isSelected ? 'text-white/90' : 'opacity-70')}`} strokeWidth={2} />
                        <span>{shortName}</span>
                        {isPreferred && (
                          <span className="text-[10px] font-bold opacity-90" title="已固定为此渠道优先显示">📌</span>
                        )}
                        {isRetry && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="连接超时，点击可查看或重试" />
                        )}
                      </button>
                    );
                  })
                ) : (
                  enabledPlaceholderTabs.map((tab, idx) => {
                    const TabIcon = tab.icon;
                    const isPreferred = preferredEngine.toLowerCase() === tab.name.toLowerCase();
                    return (
                      <button
                        key={tab.name}
                        type="button"
                        onClick={() => {
                          setPreferredEngine(tab.name);
                          try { localStorage.setItem('maobu_preferred_engine', tab.name); } catch {}
                        }}
                        title={`${tab.name} - 点击固定为此渠道优先显示`}
                        className={`px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer transition ${
                          isPreferred
                            ? "font-bold text-white shadow-sm"
                            : (isLight ? "font-medium text-slate-600 hover:bg-slate-200/80" : "font-medium text-zinc-300 hover:bg-white/10")
                        }`}
                        style={isPreferred ? { background: 'var(--accent)' } : undefined}
                      >
                        <TabIcon className={`h-3.5 w-3.5 ${isPreferred ? '' : 'opacity-70'}`} />
                        <span>{tab.name}</span>
                        {isPreferred && <span className="text-[10px]">📌</span>}
                      </button>
                    );
                  })
                )}
              </div>

              {canScrollLeft && (
                <button
                  type="button"
                  onClick={() => handleElasticScroll(-120)}
                  className={`absolute left-0 top-1/2 -translate-y-1/2 p-1 rounded-full shadow-md z-20 cursor-pointer transition ${
                    isLight ? 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-100' : 'bg-zinc-800 text-zinc-100 border border-white/10 hover:bg-zinc-700'
                  }`}
                  title="向左滚动"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              )}

              {canScrollRight && (
                <button
                  type="button"
                  onClick={() => handleElasticScroll(120)}
                  className={`absolute right-0 top-1/2 -translate-y-1/2 p-1 rounded-full shadow-md z-20 cursor-pointer transition ${
                    isLight ? 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-100' : 'bg-zinc-800 text-zinc-100 border border-white/10 hover:bg-zinc-700'
                  }`}
                  title="向右滚动"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => performTranslation(sourceText, sourceLang, targetLang)}
              className={`p-1.5 rounded-lg transition shrink-0 cursor-pointer ${
                isLight ? 'hover:bg-slate-100 text-slate-700 hover:text-slate-900' : 'hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100'
              }`}
              title="重新翻译"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="flex-1 w-full overflow-y-auto py-3 text-base leading-relaxed scrollbar-thin relative">
            {loading ? (
              <div className="space-y-3 py-1 animate-pulse">
                <div className={`h-4 rounded ${isLight ? 'bg-slate-200' : 'bg-slate-700/50'} w-3/4 mb-2`} />
                <div className={`h-4 rounded ${isLight ? 'bg-slate-200' : 'bg-slate-700/50'} w-1/2 mb-2`} />
                <div className={`h-4 rounded ${isLight ? 'bg-slate-200' : 'bg-slate-700/50'} w-5/6 mb-2`} />
                <div className={`h-4 rounded ${isLight ? 'bg-slate-200' : 'bg-slate-700/50'} w-2/3 mb-2`} />
              </div>
            ) : currentTranslationText ? (
              <div className="relative inline-block w-full">
                {isCurrentCgTerm && (
                  <div className="flex items-center space-x-2 mb-2">
                    <div
                      className="relative inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-500/20 text-sky-300 border border-sky-400/40 shadow-xs cursor-help"
                      onMouseEnter={() => setHoveredMainCg(true)}
                      onMouseLeave={() => setHoveredMainCg(false)}
                    >
                      <span className="inline-flex items-center gap-1"><Snowflake className="h-3 w-3" />CG 术语</span>
                      <span className="text-[10px] opacity-80 font-mono">[{currentEngine?.sourceTier || '3D 词库'}]</span>

                      {hoveredMainCg && renderCgPopoverTooltip(
                        response?.original || sourceText,
                        currentTranslationText,
                        currentEngine?.sourceTier || 'Preset',
                        response?.wordDetail?.cgDomainNote
                      )}
                    </div>
                  </div>
                )}

                {(() => {
                  const isConfigReq = currentEngine?.sourceTier === 'LLM (Config Required)' || currentTranslationText.includes('未配置 API Key');
                  const isAuthErr = currentEngine?.sourceTier === 'LLM (Auth Error)' || currentTranslationText.includes('API Key 无效');
                  const isQuotaErr = currentEngine?.sourceTier === 'LLM (Quota Error)' || currentTranslationText.includes('额度不足');
                  const isTimeout = currentEngine?.sourceTier === 'Online (Retry)' || currentTranslationText.includes('点击重试') || currentTranslationText.includes('网络连接超时');

                  if (isConfigReq || isAuthErr) {
                    return (
                      <div className="space-y-3 py-2">
                        <div className="flex items-center gap-2 font-semibold text-sm">
                          <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                            isConfigReq
                              ? (isLight ? 'bg-blue-100 text-blue-900 border-blue-300' : 'bg-blue-500/20 text-blue-300 border-blue-400/30')
                              : (isLight ? 'bg-rose-100 text-rose-900 border-rose-300' : 'bg-rose-500/20 text-rose-300 border-rose-400/30')
                          }`}>
                            {isConfigReq ? '[需配置]' : '[鉴权失败]'}
                          </span>
                          <span className={isConfigReq ? (isLight ? 'text-blue-950 font-bold' : 'text-blue-300') : (isLight ? 'text-rose-950 font-bold' : 'text-rose-300')}>
                            {currentTranslationText}
                          </span>
                        </div>
                        {onOpenSettings && (
                          <button
                            type="button"
                            onClick={onOpenSettings}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer active:scale-95 ${
                              isLight
                                ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 shadow-sm'
                                : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow-sm'
                            }`}
                          >
                            <Settings className="h-3.5 w-3.5" />
                            <span>⚙️ 前往配置 API Key</span>
                          </button>
                        )}
                      </div>
                    );
                  }

                  if (isQuotaErr || isTimeout) {
                    return (
                      <div className="space-y-3 py-2">
                        <div className="flex items-center gap-2 font-semibold text-sm">
                          <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                            isQuotaErr
                              ? (isLight ? 'bg-orange-100 text-orange-900 border-orange-300' : 'bg-orange-500/20 text-orange-300 border-orange-400/30')
                              : (isLight ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-400/30')
                          }`}>
                            {isQuotaErr ? '[配额超限]' : '[连接超时]'}
                          </span>
                          <span className={isQuotaErr ? (isLight ? 'text-orange-950 font-bold' : 'text-orange-300') : (isLight ? 'text-amber-950 font-bold' : 'text-amber-300')}>
                            {currentTranslationText}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRetrySingleEngine(currentEngine?.engineName || '')}
                          disabled={retryingEngines[currentEngine?.engineName || '']}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer active:scale-95 ${
                            isLight
                              ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300'
                              : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                          }`}
                          title="仅单独重新请求该引擎"
                        >
                          <RotateCcw className={`h-3.5 w-3.5 ${retryingEngines[currentEngine?.engineName || ''] ? 'animate-spin' : ''}`} />
                          <span>{retryingEngines[currentEngine?.engineName || ''] ? '正在重新请求...' : '🔄 重新请求该引擎'}</span>
                        </button>
                      </div>
                    );
                  }

                  return (
                    <p
                      className={`font-medium whitespace-pre-wrap selection:bg-blue-600 selection:text-white transition-all ${
                        isLight ? 'text-slate-900' : 'text-zinc-100'
                      } ${
                        isCurrentCgTerm
                          ? 'border-b-2 border-dashed border-sky-400 drop-shadow-[0_0_6px_rgba(56,189,248,0.6)] cursor-help pb-1'
                          : ''
                      }`}
                      onMouseEnter={() => isCurrentCgTerm && setHoveredMainCg(true)}
                      onMouseLeave={() => isCurrentCgTerm && setHoveredMainCg(false)}
                    >
                      {currentTranslationText}
                    </p>
                  );
                })()}
              </div>
            ) : (
              <div className={`h-full flex flex-col items-center justify-center text-center space-y-2 ${
                isLight ? 'text-slate-500' : 'text-zinc-400'
              }`}>
                <Languages className={`h-8 w-8 ${isLight ? 'text-slate-400' : 'text-zinc-500'}`} />
                <p className="text-sm font-medium">左侧输入或粘贴内容，右侧实时展现翻译结果</p>
                <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>支持 Google、MyMemory、CG 离线词库与 AI 大模型多引擎</p>
              </div>
            )}
          </div>

          <div className={`flex items-center justify-between gap-3 pt-2 border-t text-xs ${
            isLight ? 'border-slate-200' : 'border-zinc-800/60'
          }`}>
            <div className="flex items-center gap-2 shrink-0">
              {currentTranslationText && (
                <>
                  <button
                    type="button"
                    onClick={() => handleSpeech(currentTranslationText, targetLang)}
                    className={`p-1.5 rounded-lg border transition cursor-pointer shrink-0 ${
                      isSpeaking
                        ? "bg-blue-600/30 border-blue-400 text-blue-600"
                        : (isLight ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800" : "bg-zinc-800/80 hover:bg-zinc-700 border-zinc-700 text-zinc-200")
                    }`}
                    title="朗读译文发音"
                  >
                    <Volume2 className={`h-4 w-4 ${isSpeaking ? "animate-pulse" : ""}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopy(currentTranslationText)}
                    className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium px-3 py-1.5 rounded-lg transition shadow-sm cursor-pointer whitespace-nowrap shrink-0"
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

                  <button
                    type="button"
                    onClick={handlePinTranslation}
                    className={`flex items-center space-x-1.5 font-medium px-3 py-1.5 rounded-lg border transition cursor-pointer whitespace-nowrap shrink-0 ${
                      isLight
                        ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
                        : 'bg-zinc-800/80 hover:bg-zinc-700 border-zinc-700 text-zinc-200'
                    }`}
                    title="贴图到桌面（置顶小窗，可拖拽 / 滚轮缩放）"
                    data-testid="pin-translation-button"
                  >
                    <Pin className="h-3.5 w-3.5" />
                    <span>贴图</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportImage()}
                    disabled={exportingImage}
                    className={`flex items-center space-x-1.5 font-medium px-3 py-1.5 rounded-lg border transition cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0 ${
                      isLight
                        ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
                        : 'bg-zinc-800/80 hover:bg-zinc-700 border-zinc-700 text-zinc-200'
                    }`}
                    title="导出为分享图片（保存到 图片库/猫步翻译/exports）"
                    data-testid="export-image-button"
                  >
                    <ImageIcon className={`h-3.5 w-3.5 ${exportingImage ? "animate-pulse" : ""}`} />
                    <span>{exportingImage ? "导出中…" : "导出图片"}</span>
                  </button>
                </>
              )}
            </div>

            <div
              className="text-[11px] text-zinc-400 font-medium whitespace-nowrap truncate min-w-0 text-right"
              title={response?.engines?.length ? `已汇聚 ${response.engines.length} 个引擎对照结果` : undefined}
            >
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
            <span className={`font-medium text-[11px] ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>点击任意卡片即可直接切换主视图并复制</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {response.engines.map((engine, idx) => {
              const isSelected = selectedEngineIndex === idx;
              const isCg = isCgTermSource(engine.sourceTier, engine.engineName);
              const isHovered = hoveredCgCardIndex === idx;
              const isConfigRequired =
                engine.sourceTier === 'LLM (Config Required)' ||
                engine.sourceTier === 'Baidu (Config Required)' ||
                engine.sourceTier === 'DeepL (Config Required)' ||
                engine.translated.includes('未配置 API Key') ||
                engine.translated.includes('未配置百度') ||
                engine.translated.includes('未配置 DeepL');
              const isAuthError =
                engine.sourceTier === 'LLM (Auth Error)' ||
                engine.sourceTier === 'Baidu (Auth Error)' ||
                engine.sourceTier === 'DeepL (Auth Error)' ||
                engine.translated.includes('API Key 无效') ||
                engine.translated.includes('无效或未授权') ||
                engine.translated.includes('密钥错误');
              const isQuotaError =
                engine.sourceTier === 'LLM (Quota Error)' ||
                engine.sourceTier === 'DeepL (Quota Error)' ||
                engine.translated.includes('额度不足') ||
                engine.translated.includes('频率超限') ||
                engine.translated.includes('配额已用尽');
              const isRetry =
                engine.sourceTier === 'Online (Retry)' ||
                engine.translated.includes('点击重试') ||
                engine.translated.includes('网络连接超时');
              const isRetrying = !!retryingEngines[engine.engineName];

              return (
                <div
                  key={idx}
                  onClick={() => handleSelectEngineCard(idx, engine.translated)}
                  onMouseEnter={() => setHoveredCgCardIndex(idx)}
                  onMouseLeave={() => setHoveredCgCardIndex(null)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer group flex flex-col justify-between relative ${
                    isSelected
                      ? (isLight
                          ? (isConfigRequired
                              ? 'bg-blue-50/90 border-blue-500 shadow-md ring-2 ring-blue-500/40'
                              : isAuthError
                              ? 'bg-rose-50/90 border-rose-500 shadow-md ring-2 ring-rose-500/40'
                              : isRetry || isQuotaError
                              ? 'bg-amber-50/90 border-amber-500 shadow-md ring-2 ring-amber-500/40'
                              : 'bg-blue-50/90 border-blue-500 shadow-md ring-2 ring-blue-500/40')
                          : (isConfigRequired
                              ? 'bg-blue-950/40 border-blue-400 shadow-md ring-2 ring-blue-400/40'
                              : isAuthError
                              ? 'bg-rose-950/40 border-rose-400 shadow-md ring-2 ring-rose-400/40'
                              : isRetry || isQuotaError
                              ? 'bg-amber-950/50 border-amber-500 shadow-md ring-2 ring-amber-500/40'
                              : 'bg-blue-950/40 border-blue-400 shadow-md ring-2 ring-blue-400/40'))
                      : (isLight
                          ? (isConfigRequired
                              ? 'bg-blue-50/40 border-blue-200/80 hover:bg-blue-50 hover:border-blue-300 shadow-xs'
                              : isAuthError
                              ? 'bg-rose-50/40 border-rose-200/80 hover:bg-rose-50 hover:border-rose-300 shadow-xs'
                              : isRetry || isQuotaError
                              ? 'bg-amber-50/40 border-amber-200/80 hover:bg-amber-50 hover:border-amber-300 shadow-xs'
                              : 'bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-blue-300 shadow-xs')
                          : (isConfigRequired
                              ? 'bg-blue-950/20 border-blue-900/40 hover:border-blue-700/60 hover:bg-blue-950/30'
                              : isAuthError
                              ? 'bg-rose-950/20 border-rose-900/40 hover:border-rose-700/60 hover:bg-rose-950/30'
                              : isRetry || isQuotaError
                              ? 'bg-amber-950/20 border-amber-900/40 hover:border-amber-700/60 hover:bg-amber-950/30'
                              : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/80'))
                  }`}
                >
                  {isCg && isHovered && renderCgPopoverTooltip(
                    response.original,
                    engine.translated,
                    engine.sourceTier,
                    response.wordDetail?.cgDomainNote
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center space-x-1 ${
                        isSelected
                          ? (isConfigRequired
                              ? 'bg-blue-600 text-white border-blue-500'
                              : isAuthError
                              ? 'bg-rose-600 text-white border-rose-500'
                              : isRetry || isQuotaError
                              ? 'bg-amber-600 text-white border-amber-500'
                              : 'bg-blue-600 text-white border-blue-500')
                          : (isConfigRequired
                              ? (isLight ? 'bg-blue-100 text-blue-900 border-blue-200' : 'bg-blue-500/20 text-blue-300 border-blue-500/30')
                              : isAuthError
                              ? (isLight ? 'bg-rose-100 text-rose-900 border-rose-200' : 'bg-rose-500/20 text-rose-300 border-rose-500/30')
                              : isRetry || isQuotaError
                              ? (isLight ? 'bg-amber-100 text-amber-900 border-amber-200' : 'bg-amber-500/20 text-amber-300 border-amber-500/30')
                              : (isLight ? 'bg-blue-100 text-blue-900 border-blue-200' : 'bg-blue-500/20 text-blue-300 border-blue-500/30'))
                      }`}>
                        {isCg && <Snowflake className="h-3 w-3 text-cyan-300" />}
                        <span>{engine.engineName}</span>
                      </span>

                      {isConfigRequired ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-400/30 flex items-center space-x-1">
                          <span>[需配置]</span>
                        </span>
                      ) : isAuthError ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-400/30 flex items-center space-x-1">
                          <span>[鉴权失败]</span>
                        </span>
                      ) : isQuotaError ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-400/30 flex items-center space-x-1">
                          <span>[配额超限]</span>
                        </span>
                      ) : isRetry ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 border border-amber-400/30 flex items-center space-x-1">
                          <span>[连接超时]</span>
                        </span>
                      ) : isCg ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/30 shadow-2xs flex items-center space-x-1">
                          <span className="inline-flex items-center gap-1"><Snowflake className="h-3 w-3" />CG 术语</span>
                        </span>
                      ) : (
                        <span className={`text-[10px] font-mono ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>{engine.sourceTier}</span>
                      )}
                    </div>

                    <p className={`text-xs font-semibold line-clamp-4 leading-relaxed transition ${
                      isConfigRequired
                        ? (isLight ? 'text-blue-800' : 'text-blue-400/90')
                        : isAuthError
                        ? (isLight ? 'text-rose-800' : 'text-rose-400/90')
                        : isRetry || isQuotaError
                        ? (isLight ? 'text-amber-800' : 'text-amber-400/90')
                        : isSelected
                          ? (isLight ? 'text-blue-950 font-bold' : 'text-white font-bold')
                          : (isLight ? 'text-slate-800 group-hover:text-blue-600' : 'text-zinc-200 group-hover:text-white')
                    } ${
                      isCg ? 'border-b-2 border-dashed border-sky-400 drop-shadow-[0_0_6px_rgba(56,189,248,0.6)] pb-0.5' : ''
                    }`}>
                      {engine.translated}
                    </p>
                  </div>

                  <div className={`flex items-center justify-between pt-2 mt-2 border-t text-[10px] transition ${
                    isLight ? 'border-slate-200/80' : 'border-zinc-800/80'
                  }`}>
                    {isConfigRequired || isAuthError ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSettings?.();
                        }}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold transition cursor-pointer active:scale-95 ${
                          isLight
                            ? 'bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-300'
                            : 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border-blue-500/30'
                        }`}
                        title="点击前往系统设置配置 API Key"
                      >
                        <Settings className="h-3 w-3" />
                        <span>⚙️ 前往配置</span>
                      </button>
                    ) : isRetry || isQuotaError ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetrySingleEngine(engine.engineName);
                        }}
                        disabled={isRetrying}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold transition cursor-pointer active:scale-95 ${
                          isLight
                            ? 'bg-amber-100/80 hover:bg-amber-200 text-amber-900 border-amber-300'
                            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                        }`}
                        title="单独重新请求该引擎"
                      >
                        <RotateCcw className={`h-3 w-3 ${isRetrying ? 'animate-spin' : ''}`} />
                        <span>{isRetrying ? '重试中...' : '🔄 重试'}</span>
                      </button>
                    ) : isSelected ? (
                      <span className="text-blue-600 dark:text-blue-400 font-bold flex items-center space-x-1">
                        <Check className="h-3 w-3" />
                        <span>已置顶为主显示</span>
                      </span>
                    ) : (
                      <span className={isLight ? 'text-slate-600 group-hover:text-blue-600' : 'text-zinc-400 group-hover:text-zinc-200'}>
                        切换至该渠道 ➔
                      </span>
                    )}

                    <span className={`font-medium ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                      {isConfigRequired || isAuthError ? '前往设置' : isRetry || isQuotaError ? '点击重试' : '点击复制'}
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
