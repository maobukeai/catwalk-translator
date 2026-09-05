import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pin,
  PanelRightClose,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Trash2,
  X,
  Zap,
  MessageSquare,
  Search,
  Volume2,
  CornerDownLeft,
  Sparkles,
  Code2,
  FileText,
  Globe,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  cmdClosePin,
  cmdGetPinPayload,
  cmdOpenPin,
  cmdSetPinAlwaysOnTop,
  cmdTranslatePhrasesStyled,
  cmdUniversalTranslate,
  fetchAiDeepTranslationAnalysis,
  isTauri,
} from "../../services/tauri";
import { PinBlock, PinPayload, PinEngineOption, LlmConfig } from "../../services/types";
import { speakText } from "../../services/tts";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppTheme } from "../../hooks/useAppTheme";
import { PinChatView } from "./PinChatView";

const QUICK_SCENARIOS = [
  { label: "网页快译", icon: Globe, query: "Artificial Intelligence" },
  { label: "CG/设计术语", icon: Sparkles, query: "Ambient Occlusion" },
  { label: "代码报错", icon: Code2, query: "SyntaxError: Unexpected token" },
  { label: "学术润色", icon: FileText, query: "In this paper, we propose" },
];

/**
 * 严格过滤引擎异常、配额耗尽或超时的非正常返回文本，严防污染候选列表
 */
function isErrorTranslation(text: string): boolean {
  if (!text) return true;
  const t = text.trim();
  return (
    t.includes("点击重试") ||
    t.includes("网络连接超时") ||
    t.includes("未配置") ||
    t.includes("额度不足") ||
    t.includes("被限流") ||
    t.includes("检查账户配额") ||
    t.includes("API Key 无效") ||
    t.includes("鉴权失败") ||
    t.includes("需配置") ||
    t.includes("It's not working...") ||
    t.startsWith("[API 额度") ||
    t.startsWith("[需配置") ||
    t.startsWith("[鉴权") ||
    t.startsWith("[配额") ||
    t.startsWith("[连接超时")
  );
}

/**
 * 获取当前全局设置中激活可用的 LLM 配置
 */
function resolveActiveLlm(): LlmConfig | null {
  const settings = useSettingsStore.getState().settings;
  if (settings.llmConfigs && settings.llmConfigs.length > 0) {
    const readyFromPool = settings.llmConfigs.find(
      (c) =>
        c.enabled !== false &&
        c.endpoint &&
        (c.apiKey?.trim() ||
          c.endpoint.includes("localhost") ||
          c.endpoint.includes("127.0.0.1"))
    );
    if (readyFromPool) return readyFromPool;
  }
  if (
    settings.llmConfig?.endpoint &&
    (settings.llmConfig.apiKey?.trim() ||
      settings.llmConfig.endpoint.includes("localhost") ||
      settings.llmConfig.endpoint.includes("127.0.0.1"))
  ) {
    return settings.llmConfig;
  }
  return null;
}

/**
 * 贴图窗口根组件：仅在 label = pin_* 的独立置顶小窗中渲染（main.tsx 路由）。
 * - 单例快捷查词悬浮窗（label = pin_quick, hash = #pin=quick）与独立贴图（label = pin_{id}）共用
 * - 智能剪贴板预填：唤起时自动探测剪贴板内容（非空且 ≤300 字符直接秒查，否则自动聚焦输入条）
 * - 极简输入条：Enter 即翻，✕ 清空，支持随时二次修改查询
 * - 快慢双流竞赛呈现：本地词库/极速快译秒出，LLM AI 渐进精翻无缝平滑升级
 * - 📌 钉住与失焦生命周期：未钉住状态失焦或按 Esc 自动隐藏；钉住后置顶常驻；支持克隆为独立贴图保留桌面
 * - 💬 AI 对话模式：支持与大模型流式对话交流、提示词预设与翻译卡片一键引流追问
 */
function cleanEngineName(raw: string): string {
  if (!raw) return "";
  let name = raw.replace(/^🤖\s*/, "").trim();
  if (name === "Preset Dictionary" || name === "Offline Dict") return "预设词典";
  if (name === "Online Fallback") return "在线翻译";
  name = name.replace(/翻译$/, "");
  name = name.replace(/ \(文心版\)/, " (文心)");
  name = name.replace(/ \(OpenAI版\)/, " (OpenAI)");
  name = name.replace(/ \(Claude版\)/, " (Claude)");
  return name;
}

export function PinWindowApp() {
  const { isLight } = useAppTheme();
  const [payload, setPayload] = useState<PinPayload | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [copied, setCopied] = useState(false);
  const [copiedBlockIdx, setCopiedBlockIdx] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [hasError, setHasError] = useState(false);

  // 双模态切换：'translate' 极速快译 / 'chat' AI 对话
  const [activeTab, setActiveTab] = useState<"translate" | "chat">("translate");
  const [chatContextTerm, setChatContextTerm] = useState<string | null>(null);

  // 获取 URL hash 中的 pin id
  const rawId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.hash.replace(/^#/, "")).get("pin") || ""
    : "";
  const isQuick = rawId === "quick" || rawId === "pin_quick";

  const [isPinned, setIsPinned] = useState<boolean>(true);
  const isPinnedRef = useRef<boolean>(true);
  isPinnedRef.current = isPinned;

  const pinIdRef = useRef<string>(rawId);
  const isQuickRef = useRef<boolean>(isQuick);
  isQuickRef.current = isQuick;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const transSeqRef = useRef<number>(0);
  const wakeTimeRef = useRef<number>(Date.now());

  // ── 屏幕边缘吸附与收纳状态 ──
  const [dockEdge, setDockEdge] = useState<"left" | "right" | null>(null);
  const dockEdgeRef = useRef<"left" | "right" | null>(null);
  dockEdgeRef.current = dockEdge;

  const [isHoverExpanded, setIsHoverExpanded] = useState<boolean>(false);
  const isHoverExpandedRef = useRef<boolean>(false);
  isHoverExpandedRef.current = isHoverExpanded;

  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragEdgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedNormalGeometryRef = useRef<{
    width: number;
    height: number;
    y: number;
  }>({
    width: 460,
    height: 520,
    y: 100,
  });

  // 首页同款：词典与 AI 深度解析折叠状态映射 (key: block original, 默认 false 即展开)
  const [collapsedAnalysisMap, setCollapsedAnalysisMap] = useState<Record<string, boolean>>({});

  // 切换指定卡片的主译文至选中引擎
  const handleSwitchEngine = useCallback((blockIdx: number, opt: PinEngineOption) => {
    setPayload((prev) => {
      if (!prev) return prev;
      const newBlocks = [...prev.blocks];
      const target = newBlocks[blockIdx];
      if (!target) return prev;
      newBlocks[blockIdx] = {
        ...target,
        translated: opt.translated,
        sourceTier: opt.engineName,
        selectedEngineName: opt.engineName,
      };
      return {
        ...prev,
        blocks: newBlocks,
      };
    });
  }, []);

  // ── 快慢双流竞赛翻译执行逻辑 ──
  const executeRaceTranslation = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const seq = ++transSeqRef.current;
      setIsTranslating(true);
      setHasError(false);

      const curSettings = useSettingsStore.getState().settings;
      const preset = curSettings.defaultPreset || "blender";
      const style = curSettings.translationStyle || "free";

      // 1. Stage 0: 闪电先锋快通道 (本地术语表 / 离线词库 / 极速在线秒出 100ms 呈现)
      cmdTranslatePhrasesStyled([trimmed], preset, null, style, "auto")
        .then(([flashRes]) => {
          if (seq !== transSeqRef.current) return;
          if (flashRes && flashRes.translated && flashRes.translated.trim()) {
            setPayload((prev) => {
              const fastBlock: PinBlock = {
                original: trimmed,
                translated: flashRes.translated,
                sourceTier: flashRes.sourceTier
                  ? `⚡ 极速快译 (${flashRes.sourceTier})`
                  : "⚡ 极速快译",
              };
              const prevBlocks = prev?.blocks || [];
              const otherBlocks = prevBlocks.filter((b) => b.original !== trimmed);
              return {
                id: pinIdRef.current || (isQuick ? "quick" : `pin_${Date.now()}`),
                title: "贴图",
                blocks: [...otherBlocks, fastBlock],
                x: prev?.x || 0,
                y: prev?.y || 0,
                width: prev?.width || 460,
                height: prev?.height || 520,
              };
            });
          }
        })
        .catch(() => {});

      // 2. Stage 1 & 2: 全引擎多源并发大竞速与大模型 AI 渐进精翻升级
      try {
        const univRes = await cmdUniversalTranslate({
          text: trimmed,
          sourceLang: "auto",
          targetLang: "auto",
          preset,
          llmConfig: curSettings.llmConfig,
          llmConfigs: curSettings.llmConfigs,
          presetDicts: curSettings.presetDicts,
          onlineEngines: curSettings.onlineEngines,
          style,
          baiduAppId: curSettings.baiduAppId,
          baiduSecret: curSettings.baiduSecret,
          baiduLlmApiKey: curSettings.baiduLlmApiKey,
          deeplApiKey: curSettings.deeplApiKey,
          deeplCustomUrl: curSettings.deeplCustomUrl,
          volcengineAccessKey: curSettings.volcengineAccessKey,
          volcengineSecretKey: curSettings.volcengineSecretKey,
          yandexApiKey: curSettings.yandexApiKey,
          yandexFolderId: curSettings.yandexFolderId,
        });

        if (seq !== transSeqRef.current) return;

        // 归一化对比键：去除首尾空白、引号与标点符号并转小写，避免 "Hello." 与 "Hello" 被误拆为两个卡片
        const normalizeKey = (s: string) =>
          s
            .trim()
            .replace(/^[\s"“'‘`]+|[\s"”'’`.,!?;:。，！？；：、~]+$/g, "")
            .toLowerCase();

        const translationGroups: Array<{
          original: string;
          translated: string;
          engineNames: string[];
          isMain: boolean;
        }> = [];

        // 首选优质/AI精翻主译文
        if (univRes.mainTranslation && univRes.mainTranslation.trim()) {
          const mainTrimmed = univRes.mainTranslation.trim();
          const mainKey = normalizeKey(mainTrimmed);
          const matchedEng = univRes.engines.find(
            (e) => e.translated && normalizeKey(e.translated) === mainKey
          );
          const initialName = matchedEng ? cleanEngineName(matchedEng.engineName || matchedEng.sourceTier) : "";
          translationGroups.push({
            original: trimmed,
            translated: univRes.mainTranslation,
            engineNames: initialName ? [initialName] : [],
            isMain: true,
          });
        }

        // 附加其他有效引擎结果（排重合并同源，严格过滤异常报错）
        for (const eng of univRes.engines) {
          if (
            !eng.translated ||
            !eng.translated.trim() ||
            isErrorTranslation(eng.translated)
          ) {
            continue;
          }

          const engCleanText = eng.translated.trim();
          const engKey = normalizeKey(engCleanText);
          const engName = cleanEngineName(eng.engineName || eng.sourceTier);

          const existingGroup = translationGroups.find(
            (g) => normalizeKey(g.translated) === engKey
          );

          if (existingGroup) {
            if (engName && !existingGroup.engineNames.includes(engName)) {
              existingGroup.engineNames.push(engName);
            }
          } else {
            translationGroups.push({
              original: trimmed,
              translated: eng.translated,
              engineNames: engName ? [engName] : [],
              isMain: false,
            });
          }
        }

        if (translationGroups.length > 0) {
          const primaryGroup = translationGroups[0];
          const altGroups = translationGroups.slice(1);

          let sourceTier = "";
          if (primaryGroup.engineNames.length === 0) {
            sourceTier = primaryGroup.isMain ? "综合精翻" : "在线翻译";
          } else if (primaryGroup.engineNames.length === 1) {
            sourceTier = primaryGroup.engineNames[0];
          } else {
            sourceTier = `${primaryGroup.engineNames.join(" · ")} (${primaryGroup.engineNames.length}源一致)`;
          }

          const alternatives: string[] = altGroups.map(
            (g) => `${g.translated} (${g.engineNames.join(" / ") || "候选"})`
          );

          // 构建精简多引擎对比选项（严格排重，支持点击切换主译文）
          const engineOptions: PinEngineOption[] = translationGroups.map((g) => ({
            engineName: g.engineNames.join(" / ") || (g.isMain ? "综合精翻" : "候选参考"),
            translated: g.translated,
            sourceTier: g.engineNames.join(" · ") || (g.isMain ? "综合精翻" : "候选参考"),
          }));

          const primaryEngineTitle =
            primaryGroup.engineNames.join(" / ") || (primaryGroup.isMain ? "综合精翻" : "在线翻译");

          const newBlock: PinBlock = {
            original: trimmed,
            translated: primaryGroup.translated,
            sourceTier,
            wordDetail: univRes.wordDetail || undefined,
            engineOptions: engineOptions.length > 0 ? engineOptions : undefined,
            selectedEngineName: primaryEngineTitle,
            alternatives: alternatives.length > 0 ? alternatives : undefined,
          };

          setPayload((prev) => {
            const prevBlocks = prev?.blocks || [];
            const otherBlocks = prevBlocks.filter((b) => b.original !== trimmed);
            return {
              id: pinIdRef.current || (isQuick ? "quick" : `pin_${Date.now()}`),
              title: "贴图",
              blocks: [...otherBlocks, newBlock],
              x: prev?.x || 0,
              y: prev?.y || 0,
              width: prev?.width || 460,
              height: prev?.height || 520,
            };
          });

          // 首页同款：异步请求 AI 重点词汇拆解与地道例句，平滑注入卡片
          const activeLlm = resolveActiveLlm();
          if (activeLlm && primaryGroup.translated && !isErrorTranslation(primaryGroup.translated)) {
            fetchAiDeepTranslationAnalysis(trimmed, primaryGroup.translated, "auto", "auto", activeLlm, false)
              .then((analysis) => {
                if (analysis && ((analysis.vocabulary && analysis.vocabulary.length > 0) || (analysis.examples && analysis.examples.length > 0))) {
                  if (seq !== transSeqRef.current) return;
                  setPayload((curr) => {
                    if (!curr) return curr;
                    const updatedBlocks = curr.blocks.map((blk) =>
                      blk.original === trimmed ? { ...blk, deepAnalysis: analysis } : blk
                    );
                    return { ...curr, blocks: updatedBlocks };
                  });
                }
              })
              .catch((err) => console.warn("[PinWindow] fetchAiDeepTranslationAnalysis fallback:", err));
          }
        } else {
          setHasError(true);
        }
      } catch (err) {
        console.error("Race translation error:", err);
      } finally {
        if (seq === transSeqRef.current) {
          setIsTranslating(false);
          setPayload((curr) => {
            if (!curr || curr.blocks.length === 0) {
              setHasError(true);
            }
            return curr;
          });
        }
      }
    },
    [isQuick]
  );

  // ── 智能探测剪贴板内容 ──
  const probeClipboard = useCallback(async () => {
    wakeTimeRef.current = Date.now();
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text ? text.trim() : "";
      if (trimmed && trimmed.length <= 300) {
        setQuery(trimmed);
        void executeRaceTranslation(trimmed);
        setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 50);
      } else {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } catch {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [executeRaceTranslation]);

  // ── 挂载初始化与事件监听 ──
  useEffect(() => {
    const id = new URLSearchParams(
      typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : ""
    ).get("pin");

    if (!id) {
      if (isQuick) {
        setPayload({
          id: "quick",
          title: "贴图",
          blocks: [],
          x: 0,
          y: 0,
          width: 460,
          height: 520,
        });
        void probeClipboard();
      }
      return;
    }

    pinIdRef.current = id;
    let disposed = false;

    if (id === "quick" || id === "pin_quick") {
      // 桌面贴图悬浮小窗模式
      cmdGetPinPayload(id).then((p) => {
        if (!disposed) {
          if (p) {
            setPayload(p);
            if (p.title && p.title !== "翻译结果" && p.title !== "贴图") setQuery(p.title);
          } else {
            setPayload({
              id: "quick",
              title: "贴图",
              blocks: [],
              x: 0,
              y: 0,
              width: 460,
              height: 520,
            });
          }
          void probeClipboard();
        }
      });
    } else {
      // 普通独立贴图模式
      cmdGetPinPayload(id).then((p) => {
        if (!disposed && p) setPayload(p);
      });
    }

    // 独立窗体挂载即刻拉取全局设置，拉取成功后再探测剪贴板，确保凭据完全就绪
    useSettingsStore
      .getState()
      .fetchSettings()
      .finally(() => {
        if (!disposed && (id === "quick" || id === "pin_quick")) {
          void probeClipboard();
        }
      });

    // 监听 Tauri 事件：贴图内容更新、快捷查词再次唤醒、全局设置热变更
    let unlistenUpdated: (() => void) | null = null;
    let unlistenTriggered: (() => void) | null = null;
    let unlistenSettings: (() => void) | null = null;

    if (isTauri()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen<PinPayload>("pin-updated", (event) => {
          if (!disposed && event.payload && (event.payload.id === pinIdRef.current || isQuickRef.current)) {
            setPayload(event.payload);
            if (event.payload.title && event.payload.title !== "翻译结果") {
              setQuery(event.payload.title);
            }
            setCollapsed(false);
          }
        }).then((u) => {
          if (disposed) u();
          else unlistenUpdated = u;
        });

        listen("quick-window-triggered", async () => {
          if (!disposed && isQuickRef.current) {
            wakeTimeRef.current = Date.now();
            setCollapsed(false);
            setDockEdge(null);
            dockEdgeRef.current = null;
            setIsHoverExpanded(false);
            isHoverExpandedRef.current = false;
            await useSettingsStore.getState().fetchSettings();
            void probeClipboard();
          }
        }).then((u) => {
          if (disposed) u();
          else unlistenTriggered = u;
        });

        listen("settings-updated", () => {
          if (!disposed) {
            void useSettingsStore.getState().fetchSettings();
          }
        }).then((u) => {
          if (disposed) u();
          else unlistenSettings = u;
        });
      });
    }

    return () => {
      disposed = true;
      if (unlistenUpdated) unlistenUpdated();
      if (unlistenTriggered) unlistenTriggered();
      if (unlistenSettings) unlistenSettings();
    };
  }, [isQuick, probeClipboard]);

  // ── 模式与内容自适应窗口大小（翻译与对话模式窗口尺寸统一保持一致，均以对话窗口尺寸 460x520 起步，切换模式绝不缩放跳变） ──
  useEffect(() => {
    if (!isTauri() || typeof window === "undefined") return;

    if (collapsed) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow, LogicalSize }) => {
        getCurrentWindow().setSize(new LogicalSize(window.innerWidth, 38)).catch(() => undefined);
      });
      return;
    }

    // 翻译模式与对话模式统一采用对话窗口标准尺寸（宽至少 460，高至少 520）
    // 用户手动拉伸放大后，完全尊重并保留更大尺寸，两模式切换时绝不发生缩放跳变
    import("@tauri-apps/api/window").then(({ getCurrentWindow, LogicalSize }) => {
      const targetW = Math.max(window.innerWidth, 460);
      const targetH = Math.max(window.innerHeight, 520);
      if (window.innerWidth < 460 || window.innerHeight < 520) {
        getCurrentWindow().setSize(new LogicalSize(targetW, targetH)).catch(() => undefined);
      }
    });
  }, [collapsed, activeTab]);

  // ── 窗口关闭 / 隐藏处理 ──
  const handleClose = useCallback(async () => {
    const id = pinIdRef.current || payload?.id || "";
    if (isQuick) {
      if (isTauri()) {
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
          getCurrentWindow().hide().catch(() => undefined)
        );
      }
      return;
    }
    if (id) await cmdClosePin(id).catch(() => undefined);
    if (isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().close().catch(() => undefined)
      );
    }
  }, [payload, isQuick]);

  // ── 📌 钉住状态切换 ──
  const togglePin = useCallback(async () => {
    const nextPinned = !isPinned;
    setIsPinned(nextPinned);
    isPinnedRef.current = nextPinned;

    if (isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow().setAlwaysOnTop(nextPinned).catch(() => undefined);
      });
      const label = isQuick
        ? "pin_quick"
        : pinIdRef.current.startsWith("pin_")
        ? pinIdRef.current
        : `pin_${pinIdRef.current}`;
      cmdSetPinAlwaysOnTop(label, nextPinned).catch(() => undefined);
    }
  }, [isPinned, isQuick]);

  // ── 失焦生命周期：未钉住状态下失焦自动隐藏 ──
  useEffect(() => {
    const handleBlur = () => {
      // 避免窗口刚被唤醒/创建时的瞬时焦点微弱抖动导致误关
      if (Date.now() - wakeTimeRef.current < 350) return;
      if (isQuickRef.current && !isPinnedRef.current) {
        void handleClose();
      }
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [handleClose]);

  // ── Esc 快捷关闭 ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  // ── 复制全部译文 ──
  const handleCopyAll = useCallback(() => {
    if (!payload || payload.blocks.length === 0) return;
    const all = payload.blocks
      .map((b) => b.translated || b.original)
      .filter(Boolean)
      .join("\n");
    if (!all) return;
    navigator.clipboard.writeText(all).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [payload]);

  // ── 逐条复制 ──
  const handleCopyBlock = useCallback((text: string, index: number) => {
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedBlockIdx(index);
    setTimeout(() => setCopiedBlockIdx((curr) => (curr === index ? null : curr)), 1500);
  }, []);

  // ── 滚轮调整字号（需配合 Ctrl 键，避免劫持并阻断译文/对话文本正常上下滚动） ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.deltaY < 0 ? 0.1 : -0.1;
    setFontScale((s) =>
      Math.min(1.6, Math.max(0.7, Math.round((s + step) * 10) / 10))
    );
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onNativeWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      const step = ev.deltaY < 0 ? 0.1 : -0.1;
      setFontScale((s) =>
        Math.min(1.6, Math.max(0.7, Math.round((s + step) * 10) / 10))
      );
    };
    el.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => el.removeEventListener("wheel", onNativeWheel);
  }, []);

  // ── 翻译会话滚动到底部与清空 ──
  useEffect(() => {
    if (activeTab === "translate" && typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [payload?.blocks.length, isTranslating, activeTab]);

  const handleClearTranslateHistory = useCallback(() => {
    setPayload((p) => (p ? { ...p, blocks: [] } : null));
    setQuery("");
    inputRef.current?.focus();
  }, []);

  // ── 靠边收起为边缘小胶囊 ──
  const shrinkToCapsule = useCallback(async (edgeParam?: "left" | "right") => {
    const targetEdge = edgeParam || dockEdgeRef.current || "right";
    setDockEdge(targetEdge);
    dockEdgeRef.current = targetEdge;
    setIsHoverExpanded(false);
    isHoverExpandedRef.current = false;

    if (!isTauri()) return;

    try {
      const { getCurrentWindow, PhysicalPosition, PhysicalSize, currentMonitor } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const monitor = await currentMonitor();
      if (!monitor) return;

      const scale = monitor.scaleFactor || 1.0;
      const currentPos = await win.outerPosition();
      const currentSize = await win.outerSize();

      // 记录正常模式时的视口尺寸
      if (currentSize.width > 100 * scale) {
        savedNormalGeometryRef.current = {
          width: Math.round(currentSize.width / scale),
          height: Math.round(currentSize.height / scale),
          y: Math.round(currentPos.y / scale),
        };
      }

      const monLeft = monitor.position.x;
      const monTop = monitor.position.y;
      const monRight = monitor.position.x + monitor.size.width;
      const monBottom = monitor.position.y + monitor.size.height;

      const capsulePhysW = Math.round(26 * scale);
      const capsulePhysH = Math.round(88 * scale);

      const targetX = targetEdge === "left" ? monLeft : monRight - capsulePhysW;
      const targetY = Math.max(monTop + 20, Math.min(monBottom - capsulePhysH - 60, currentPos.y));

      await win.setSize(new PhysicalSize(capsulePhysW, capsulePhysH));
      await win.setPosition(new PhysicalPosition(targetX, targetY));
    } catch (e) {
      console.error("shrinkToCapsule error:", e);
    }
  }, []);

  // ── 智能就近靠边 ──
  const handleDockToEdge = useCallback(async (edgeOverride?: "left" | "right") => {
    if (!isTauri()) {
      const target = edgeOverride || (dockEdgeRef.current === "left" ? "right" : "right");
      setDockEdge(target);
      dockEdgeRef.current = target;
      setIsHoverExpanded(false);
      isHoverExpandedRef.current = false;
      return;
    }

    try {
      const { getCurrentWindow, currentMonitor } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const monitor = await currentMonitor();
      if (!monitor) {
        void shrinkToCapsule(edgeOverride || "right");
        return;
      }

      let chosenEdge: "left" | "right" = edgeOverride || "right";
      if (!edgeOverride) {
        const currentPos = await win.outerPosition();
        const currentSize = await win.outerSize();
        const winCenterX = currentPos.x + currentSize.width / 2;
        const monCenterX = monitor.position.x + monitor.size.width / 2;
        chosenEdge = winCenterX < monCenterX ? "left" : "right";
      }

      void shrinkToCapsule(chosenEdge);
    } catch {
      void shrinkToCapsule("right");
    }
  }, [shrinkToCapsule]);

  // ── 鼠标悬停展开 ──
  const handleHoverExpand = useCallback(async () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsHoverExpanded(true);
    isHoverExpandedRef.current = true;

    if (!isTauri()) return;

    try {
      const { getCurrentWindow, PhysicalPosition, PhysicalSize, currentMonitor } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const monitor = await currentMonitor();
      if (!monitor) return;

      const scale = monitor.scaleFactor || 1.0;
      const currentPos = await win.outerPosition();
      const normW = Math.max(460, savedNormalGeometryRef.current.width);
      const normH = Math.max(520, savedNormalGeometryRef.current.height);
      const expandPhysW = Math.round(normW * scale);
      const expandPhysH = Math.round(normH * scale);

      const monLeft = monitor.position.x;
      const monTop = monitor.position.y;
      const monRight = monitor.position.x + monitor.size.width;
      const monBottom = monitor.position.y + monitor.size.height;

      const edge = dockEdgeRef.current || "right";
      const targetX = edge === "left" ? monLeft : monRight - expandPhysW;
      const targetY = Math.max(monTop + 10, Math.min(monBottom - expandPhysH - 40, currentPos.y));

      await win.setSize(new PhysicalSize(expandPhysW, expandPhysH));
      await win.setPosition(new PhysicalPosition(targetX, targetY));
    } catch (e) {
      console.error("handleHoverExpand error:", e);
    }
  }, []);

  // ── 解除靠边吸附 ──
  const handleUndock = useCallback(async () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    const prevEdge = dockEdgeRef.current;
    setDockEdge(null);
    dockEdgeRef.current = null;
    setIsHoverExpanded(false);
    isHoverExpandedRef.current = false;

    if (!isTauri()) return;

    try {
      const { getCurrentWindow, PhysicalPosition, PhysicalSize, currentMonitor } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const monitor = await currentMonitor();
      if (!monitor) return;

      const scale = monitor.scaleFactor || 1.0;
      const currentPos = await win.outerPosition();
      const normW = Math.max(460, savedNormalGeometryRef.current.width);
      const normH = Math.max(520, savedNormalGeometryRef.current.height);
      const physW = Math.round(normW * scale);
      const physH = Math.round(normH * scale);

      const monLeft = monitor.position.x;
      const monRight = monitor.position.x + monitor.size.width;

      const targetX = prevEdge === "left"
        ? monLeft + Math.round(48 * scale)
        : monRight - physW - Math.round(48 * scale);

      await win.setSize(new PhysicalSize(physW, physH));
      await win.setPosition(new PhysicalPosition(targetX, currentPos.y));
    } catch (e) {
      console.error("handleUndock error:", e);
    }
  }, []);

  // ── 监听窗口移动，检测拖拽贴近边缘吸附与拖离边框解除吸附 ──
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenMove: (() => void) | null = null;
    let disposed = false;

    import("@tauri-apps/api/window").then(({ getCurrentWindow, currentMonitor }) => {
      if (disposed) return;
      const win = getCurrentWindow();
      win.onMoved(() => {
        if (dragEdgeTimeoutRef.current) clearTimeout(dragEdgeTimeoutRef.current);
        dragEdgeTimeoutRef.current = setTimeout(async () => {
          try {
            const monitor = await currentMonitor();
            if (!monitor) return;
            const currentPos = await win.outerPosition();
            const currentSize = await win.outerSize();
            const scale = monitor.scaleFactor || 1.0;
            const threshold = Math.max(45 * scale, 50);

            const monLeft = monitor.position.x;
            const monRight = monitor.position.x + monitor.size.width;

            const distLeft = currentPos.x - monLeft;
            const distRight = monRight - (currentPos.x + currentSize.width);

            if (dockEdgeRef.current === null) {
              if (distLeft <= threshold && distLeft >= -100) {
                void handleDockToEdge("left");
              } else if (distRight <= threshold && distRight >= -100) {
                void handleDockToEdge("right");
              }
            } else if (isHoverExpandedRef.current) {
              if (
                (dockEdgeRef.current === "left" && distLeft > 60 * scale) ||
                (dockEdgeRef.current === "right" && distRight > 60 * scale)
              ) {
                setDockEdge(null);
                dockEdgeRef.current = null;
                setIsHoverExpanded(false);
                isHoverExpandedRef.current = false;
              }
            }
          } catch (err) {
            console.error("[PinWindow] onMoved edge snap error:", err);
          }
        }, 100);
      }).then((u) => {
        if (disposed) u();
        else unlistenMove = u;
      });
    });

    return () => {
      disposed = true;
      if (dragEdgeTimeoutRef.current) clearTimeout(dragEdgeTimeoutRef.current);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      if (unlistenMove) unlistenMove();
    };
  }, [handleDockToEdge]);

  // ── 监听全局快捷键切换事件：打开状态下吸附到侧边，侧边收纳态下弹出至光标位置 ──
  useEffect(() => {
    if (!isTauri() || !isQuick) return;
    let unlistenHotkeyToggle: (() => void) | null = null;
    let disposed = false;

    import("@tauri-apps/api/event").then(({ listen }) => {
      if (disposed) return;
      listen("quick-window-hotkey-toggle", async () => {
        wakeTimeRef.current = Date.now();
        // 1. 若当前处于侧边微型胶囊收纳态（没打开全部内容）：按快捷键触发“弹出”为正常完整窗口
        if (dockEdgeRef.current !== null && !isHoverExpandedRef.current) {
          setDockEdge(null);
          dockEdgeRef.current = null;
          setIsHoverExpanded(false);
          isHoverExpandedRef.current = false;
          try {
            const { cmdRepositionPinToCursor } = await import("../../services/tauri");
            await cmdRepositionPinToCursor("pin_quick");
          } catch (e) {
            console.error("cmdRepositionPinToCursor error:", e);
          }
          setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          }, 80);
          return;
        }

        // 2. 若当前处于正常打开状态（浮动窗或悬停展开态）：快捷键默认吸附到就近侧边并收缩为小胶囊
        void handleDockToEdge();
      }).then((u) => {
        if (disposed) u();
        else unlistenHotkeyToggle = u;
      });
    });

    return () => {
      disposed = true;
      if (unlistenHotkeyToggle) unlistenHotkeyToggle();
    };
  }, [isQuick, handleDockToEdge]);

  if (!payload && !isQuick) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-[11px] text-zinc-500">
        加载贴图内容…
      </div>
    );
  }

  const currentPayload = payload || {
    id: "quick",
    title: "快捷查词",
    blocks: [],
    x: 0,
    y: 0,
    width: 460,
    height: 520,
  };

  // ── 若处于靠边收纳态且未悬停展开：渲染屏幕边缘极简微型胶囊拉手 ──
  if (dockEdge && !isHoverExpanded) {
    return (
      <div
        className={`flex h-screen w-screen select-none cursor-pointer flex-col items-center justify-between py-2 transition-colors duration-200 overflow-hidden bg-clip-padding ${
          isLight
            ? "bg-white border border-slate-300/90 text-slate-800 shadow-md hover:bg-slate-50"
            : "bg-[#0f1219] border border-white/20 text-zinc-100 shadow-md hover:bg-[#151922]"
        } ${
          dockEdge === "left"
            ? "rounded-r-2xl border-l-0 pl-0.5"
            : "rounded-l-2xl border-r-0 pr-0.5"
        }`}
        onMouseEnter={() => void handleHoverExpand()}
        onClick={() => void handleHoverExpand()}
        title="猫步悬浮查词 · 鼠标移入自动滑出展开"
        data-testid="dock-handle-capsule"
      >
        <div className="flex flex-col items-center gap-1.5 pt-0.5">
          <span className="text-xs select-none">🐱</span>
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isLight
                ? "bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.6)]"
                : "bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.7)]"
            }`}
          />
        </div>
        <span
          className={`text-[9px] font-bold tracking-tighter pb-0.5 ${
            isLight ? "text-indigo-600" : "text-indigo-300"
          }`}
        >
          {dockEdge === "left" ? "▶" : "◀"}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`relative flex h-full min-h-screen w-full flex-col overflow-hidden rounded-2xl transition-colors duration-200 bg-clip-padding ${
        isLight
          ? "border border-slate-200/90 bg-white text-slate-800 shadow-2xl"
          : "border border-white/10 bg-[#0c0e15] text-zinc-100 shadow-2xl"
      } ${!collapsed ? "min-h-[480px]" : ""}`}
      onWheel={handleWheel}
      onMouseEnter={() => {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
      }}
      onMouseLeave={() => {
        if (dockEdgeRef.current && !isPinnedRef.current) {
          if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = setTimeout(() => {
            void shrinkToCapsule();
          }, 350);
        }
      }}
    >
      {/* 标题栏：拖拽区 + 状态指示 + 控制按钮 */}
      <div
        className={`flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 cursor-move select-none transition-colors ${
          isLight
            ? "border-slate-200/80 bg-slate-50/90 text-slate-700"
            : "border-white/[0.08] bg-white/[0.03] text-zinc-300"
        }`}
        data-tauri-drag-region
      >
        <div className="flex min-w-0 items-center gap-1.5" data-tauri-drag-region>
          {/* 📌 钉住按钮：仅保留精致单钉矢量图标，隐藏冗余 emoji 并消除点击外框 */}
          <button
            type="button"
            onClick={togglePin}
            className={`h-6.5 w-6.5 rounded-lg transition-all duration-200 flex items-center justify-center cursor-pointer select-none active:scale-95 outline-none focus:outline-none focus-visible:outline-none ${
              isPinned
                ? isLight
                  ? "bg-indigo-50 border border-indigo-200/90 text-indigo-600 shadow-2xs"
                  : "bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 shadow-2xs"
                : isLight
                  ? "text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
            }`}
            title={isPinned ? "📌 已钉在桌面（常驻不失焦）" : "📌 点击钉在桌面（当前失焦自动关闭）"}
            data-testid="pin-toggle"
          >
            <Pin className={`w-3.5 h-3.5 transition-transform duration-200 ${isPinned ? "rotate-45 fill-indigo-500/30" : ""}`} />
            <span className="sr-only">📌</span>
          </button>

          {/* 标题文本 */}
          <span
            className={`truncate text-xs font-bold tracking-tight select-none ${
              isLight ? "text-slate-800" : "text-zinc-100"
            } ${collapsed ? "" : "max-w-[120px]"}`}
            data-tauri-drag-region
            title="猫步翻译 · 桌面贴图"
          >
            {collapsed
              ? `贴图 · ${currentPayload.blocks.length} 段`
              : "贴图"}
          </span>
          {collapsed && (
            <span
              className={`truncate text-[10px] ${isLight ? "text-slate-500" : "text-zinc-400"}`}
              data-tauri-drag-region
            >
              {currentPayload.blocks[0]?.translated || currentPayload.blocks[0]?.original || ""}
            </span>
          )}

          {/* 双模态 Tabs 切换器：高度对齐，彻底清除浏览器默认聚焦蓝边 */}
          {!collapsed && (
            <div
              className={`inline-flex items-center h-6.5 rounded-lg p-0.5 text-[10px] transition-colors ml-1 ${
                isLight
                  ? "bg-slate-200/60 border border-slate-300/40"
                  : "bg-black/40 border border-white/10"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveTab("translate")}
                className={`h-5.5 px-2.5 rounded-md font-medium transition-all duration-200 cursor-pointer flex items-center gap-1 active:scale-95 outline-none focus:outline-none focus-visible:outline-none select-none ${
                  activeTab === "translate"
                    ? isLight
                      ? "bg-white text-indigo-600 shadow-xs font-bold"
                      : "bg-indigo-600 text-white shadow-xs font-bold"
                    : isLight
                      ? "text-slate-600 hover:text-slate-900 hover:bg-slate-300/30"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                }`}
                title="极速快译与词库双流查词"
                data-testid="tab-translate"
              >
                <Zap className={`w-3 h-3 ${activeTab === "translate" ? "text-amber-500 fill-amber-500" : "text-slate-400"}`} />
                <span>翻译</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className={`h-5.5 px-2.5 rounded-md font-medium transition-all duration-200 cursor-pointer flex items-center gap-1 active:scale-95 outline-none focus:outline-none focus-visible:outline-none select-none ${
                  activeTab === "chat"
                    ? isLight
                      ? "bg-white text-indigo-600 shadow-xs font-bold"
                      : "bg-indigo-600 text-white shadow-xs font-bold"
                    : isLight
                      ? "text-slate-600 hover:text-slate-900 hover:bg-slate-300/30"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                }`}
                title="LLM 大模型智能对话与深度追问"
                data-testid="tab-chat"
              >
                <MessageSquare className={`w-3 h-3 ${activeTab === "chat" ? "text-indigo-500 fill-indigo-500/20" : "text-slate-400"}`} />
                <span>对话</span>
              </button>
            </div>
          )}
        </div>

        {/* 右侧微晶统一操作工具组 */}
        <div className="flex shrink-0 items-center gap-0.5">
          {/* 折叠/展开 */}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={`h-6.5 w-6.5 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              isLight
                ? "text-slate-500 hover:bg-slate-200/60 hover:text-slate-900"
                : "text-zinc-400 hover:bg-white/10 hover:text-white"
            }`}
            title={collapsed ? "展开全部内容" : "折叠（只留标题与首条译文）"}
            data-testid="pin-collapse"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            <span className="sr-only">{collapsed ? "▸" : "▾"}</span>
          </button>

          {/* 靠边收起按钮 */}
          <button
            type="button"
            onClick={() => {
              if (dockEdge) {
                void handleUndock();
              } else {
                void handleDockToEdge();
              }
            }}
            className={`h-6.5 w-6.5 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              dockEdge
                ? isLight
                  ? "bg-indigo-50 border border-indigo-200/80 text-indigo-600 font-bold"
                  : "bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 font-bold"
                : isLight
                  ? "text-slate-500 hover:bg-slate-200/60 hover:text-slate-900"
                  : "text-zinc-400 hover:bg-white/10 hover:text-white"
            }`}
            title={dockEdge ? "解除靠边吸附" : "靠边收起 (也可直接拖拽至屏幕边缘)"}
            data-testid="pin-dock-edge"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
            <span className="sr-only">{dockEdge ? "◨" : "⇥"}</span>
          </button>

          {!collapsed && (
            <>
              {/* 缩放控制 */}
              <button
                type="button"
                onClick={() =>
                  setFontScale((s) => Math.min(1.6, Math.round((s + 0.1) * 10) / 10))
                }
                className={`h-6.5 w-6.5 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                  isLight
                    ? "text-slate-500 hover:bg-slate-200/60 hover:text-slate-900"
                    : "text-zinc-400 hover:bg-white/10 hover:text-white"
                }`}
                title="放大字号 (也可按住 Ctrl+滚轮向上)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setFontScale((s) => Math.max(0.7, Math.round((s - 0.1) * 10) / 10))
                }
                className={`h-6.5 w-6.5 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                  isLight
                    ? "text-slate-500 hover:bg-slate-200/60 hover:text-slate-900"
                    : "text-zinc-400 hover:bg-white/10 hover:text-white"
                }`}
                title="缩小字号 (也可按住 Ctrl+滚轮向下)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              {activeTab === "translate" && (
                <>
                  {/* 复制全部译文 */}
                  <button
                    type="button"
                    onClick={handleCopyAll}
                    className={`h-6.5 px-2 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1 active:scale-95 ${
                      copied
                        ? "text-emerald-500 font-bold bg-emerald-50 dark:bg-emerald-500/15"
                        : isLight
                          ? "text-slate-500 hover:bg-slate-200/60 hover:text-slate-900"
                          : "text-zinc-400 hover:bg-white/10 hover:text-white"
                    }`}
                    title="复制全部译文"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span className="text-[10.5px] font-medium">{copied ? "已复制" : "复制"}</span>
                  </button>

                  {/* 清空翻译会话 */}
                  {currentPayload.blocks.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearTranslateHistory}
                      className={`h-6.5 w-6.5 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                        isLight
                          ? "text-slate-400 hover:bg-slate-200/60 hover:text-rose-600"
                          : "text-zinc-400 hover:bg-white/10 hover:text-rose-400"
                      }`}
                      title="清空翻译会话"
                      data-testid="clear-translate-history"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="sr-only">🗑️</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* 关闭小窗 */}
          <button
            type="button"
            onClick={() => void handleClose()}
            className={`h-6.5 w-6.5 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              isLight
                ? "text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                : "text-zinc-400 hover:bg-rose-500/20 hover:text-rose-400"
            }`}
            title={isQuick && !isPinned ? "关闭 (Esc)" : "关闭贴图"}
            data-testid="pin-close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 翻译模式内容区：对话式呈现（用户提问气泡在右，译文应答卡片在左），超出时内部平滑滚动 */}
      {!collapsed && activeTab === "translate" && (
        <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-3 py-3 overscroll-contain">
          {currentPayload.blocks.length === 0 && (
            <div className="relative flex flex-col items-center justify-center py-10 px-4 text-center select-none overflow-hidden">
              {/* 弥散极光体背景 */}
              <div className="pointer-events-none absolute -top-8 h-44 w-44 rounded-full bg-gradient-to-tr from-indigo-500/15 via-purple-500/15 to-transparent blur-3xl" />

              <div
                className={`relative flex h-14 w-14 items-center justify-center rounded-2xl mb-3 shadow-md transition-transform duration-300 hover:scale-105 ${
                  isLight
                    ? "bg-gradient-to-br from-indigo-50 via-white to-indigo-50/40 text-indigo-600 border border-indigo-200/70 ring-4 ring-indigo-500/5 shadow-indigo-500/10"
                    : "bg-gradient-to-br from-indigo-500/20 via-indigo-900/30 to-purple-900/20 text-indigo-400 border border-indigo-500/30 ring-4 ring-indigo-500/10 shadow-black/40"
                }`}
              >
                <Zap className="h-7 w-7 text-indigo-600 dark:text-indigo-400 fill-indigo-500/20" />
                <span className="sr-only">⚡</span>
              </div>
              <p
                className={`text-sm font-bold tracking-tight ${
                  isLight ? "text-slate-800" : "text-zinc-100"
                }`}
              >
                对话式极速查词
              </p>
              <p
                className={`mt-1.5 text-xs max-w-[300px] leading-relaxed ${
                  isLight ? "text-slate-500" : "text-zinc-400"
                }`}
              >
                在下方输入单词或短语，按 Enter 即可快速发起多引擎竞赛翻译，支持多轮连续对照与一键深度追问。
              </p>

              {/* 灵动场景快捷芯片 */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 max-w-[320px]">
                {QUICK_SCENARIOS.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setQuery(item.query);
                        void executeRaceTranslation(item.query);
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-200 cursor-pointer shadow-2xs hover:scale-105 active:scale-95 ${
                        isLight
                          ? "bg-white/95 border border-slate-200/80 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-indigo-600 shadow-slate-200/50"
                          : "bg-white/[0.04] border border-white/10 text-zinc-300 hover:border-indigo-500/40 hover:bg-indigo-500/15 hover:text-indigo-300"
                      }`}
                      title={`点击快捷填入并翻译示例「${item.query}」`}
                    >
                      <Icon className="w-3 h-3 text-indigo-500" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 快捷键微标 */}
              <div className="mt-4 flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-zinc-500">
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 font-mono">↵ Enter 翻译</span>
                <span>·</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 font-mono">Esc 关闭</span>
                <span>·</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 font-mono">Alt+W 唤起</span>
              </div>

              {hasError && (
                <div className="mt-3 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[11px]">
                  ⚠️ 翻译未响应或无结果，请按 Enter 重试
                </div>
              )}
            </div>
          )}

          {currentPayload.blocks.map((b, i) => {
            const isFirstOfGroup = i === 0 || currentPayload.blocks[i - 1].original !== b.original;
            return (
              <div key={i} className="space-y-2">
                {/* 用户提问气泡（右对齐） */}
                {isFirstOfGroup && (
                  <div className="flex justify-end pt-1">
                    <div
                      className={`max-w-[85%] rounded-2xl rounded-tr-xs px-3.5 py-2 text-xs select-text shadow-xs ${
                        isLight
                          ? "bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-indigo-500/10"
                          : "bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-black/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2.5">
                        <span className="break-words font-medium">{b.original}</span>
                        <button
                          type="button"
                          onClick={() => speakText(b.original)}
                          className="text-white/80 hover:text-white transition cursor-pointer text-[10.5px] shrink-0 active:scale-90"
                          title="朗读原文"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 翻译应答卡片（左对齐） */}
                <div className="flex justify-start">
                  <div
                    className={`max-w-[92%] rounded-2xl rounded-tl-xs p-3.5 transition-all shadow-xs group ${
                      isLight
                        ? "bg-white/95 border border-slate-200/90 text-slate-800 shadow-slate-200/50 hover:border-indigo-200 hover:shadow-sm"
                        : "bg-white/[0.05] border border-white/[0.08] text-zinc-100 shadow-black/20 hover:border-white/15 hover:shadow-sm"
                    }`}
                  >
                    {/* 顶部助手徽标 + 引擎标签 */}
                    <div className="flex items-center justify-between gap-2 mb-1.5 text-[10px]">
                      <span
                        className={`flex items-center gap-1 font-bold ${
                          isLight ? "text-indigo-600" : "text-indigo-400"
                        }`}
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                        <span>译文</span>
                      </span>
                      {b.sourceTier && (
                        <span
                          className={`truncate px-2 py-0.5 rounded-full border text-[9.5px] max-w-[220px] font-medium ${
                            isLight
                              ? "bg-slate-100/90 text-slate-600 border-slate-200/60"
                              : "bg-white/[0.06] text-zinc-400 border-white/[0.08]"
                          }`}
                          title={b.sourceTier}
                        >
                          {b.sourceTier}
                        </span>
                      )}
                    </div>

                    {/* 译文主显示 */}
                    <p
                      className={`font-semibold select-text break-words ${
                        isLight ? "text-slate-900" : "text-zinc-100"
                      }`}
                      style={{ fontSize: `${13 * fontScale}px`, lineHeight: 1.55 }}
                    >
                      {b.translated || b.original}
                    </p>

                    {/* ── 首页同款：词典释义与 AI 深度解析折叠展示（默认收起） ── */}
                    {(() => {
                      // 默认收起解析（默认 true），点击后展开
                      const isAnalysisCollapsed =
                        collapsedAnalysisMap[b.original || `${i}`] ?? true;
                      const hasWordDetail = Boolean(
                        b.wordDetail &&
                          (b.wordDetail.definition ||
                            b.wordDetail.phoneticUs ||
                            b.wordDetail.phoneticUk ||
                            b.wordDetail.cgDomainNote ||
                            (b.wordDetail.examples && b.wordDetail.examples.length > 0))
                      );
                      const hasDeepAnalysis = Boolean(
                        b.deepAnalysis &&
                          ((b.deepAnalysis.vocabulary && b.deepAnalysis.vocabulary.length > 0) ||
                            (b.deepAnalysis.examples && b.deepAnalysis.examples.length > 0))
                      );

                      if (!hasWordDetail && !hasDeepAnalysis) return null;

                      return (
                        <div
                          className={`mt-2.5 rounded-xl border transition-all overflow-hidden ${
                            isLight
                              ? "bg-slate-50/85 border-slate-200/80 shadow-2xs"
                              : "bg-white/[0.03] border-white/[0.08]"
                          }`}
                        >
                          {/* 解析折叠/展开标头 */}
                          <div
                            className={`flex items-center justify-between px-2.5 py-1.5 select-none ${
                              !isAnalysisCollapsed ? "border-b" : ""
                            } ${
                              isLight
                                ? "border-slate-200/70 bg-slate-100/60"
                                : "border-white/[0.06] bg-white/[0.02]"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 text-[10.5px] font-semibold">
                              <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
                              <span className={isLight ? "text-slate-700" : "text-zinc-200"}>
                                {hasWordDetail && b.wordDetail?.cgDomainNote
                                  ? "术语与词典解析"
                                  : "深度解析与重点词汇"}
                              </span>
                              {b.wordDetail?.cgDomainNote && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-400/30 shrink-0">
                                  ❄️ {b.wordDetail.cgDomainNote}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setCollapsedAnalysisMap((prev) => ({
                                  ...prev,
                                  [b.original || `${i}`]: !isAnalysisCollapsed,
                                }));
                              }}
                              className={`flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-md cursor-pointer transition select-none active:scale-95 outline-none focus:outline-none focus-visible:outline-none ${
                                isLight
                                  ? "text-slate-500 hover:text-slate-800 hover:bg-slate-200/60"
                                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                              }`}
                              title={isAnalysisCollapsed ? "展开完整解析详情" : "收起解析"}
                              data-testid={`toggle-analysis-btn-${i}`}
                            >
                              <span>{isAnalysisCollapsed ? "展开解析" : "收起解析"}</span>
                              {isAnalysisCollapsed ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronUp className="w-3 h-3" />
                              )}
                            </button>
                          </div>

                          {/* 展开内容 */}
                          {!isAnalysisCollapsed && (
                            <div className="p-2.5 space-y-2 text-xs">
                              {/* 1. 词典信息：音标、词性、释义与例句 */}
                              {hasWordDetail && b.wordDetail && (
                                <div className="space-y-1">
                                  {(b.wordDetail.phoneticUs ||
                                    b.wordDetail.phoneticUk ||
                                    b.wordDetail.pos) && (
                                    <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                                      {(b.wordDetail.phoneticUs || b.wordDetail.phoneticUk) && (
                                        <span className="font-mono text-slate-500 dark:text-zinc-400">
                                          {b.wordDetail.phoneticUs && `美 ${b.wordDetail.phoneticUs}`}
                                          {b.wordDetail.phoneticUs && b.wordDetail.phoneticUk && "  |  "}
                                          {b.wordDetail.phoneticUk && `英 ${b.wordDetail.phoneticUk}`}
                                        </span>
                                      )}
                                      {b.wordDetail.pos && (
                                        <span className="px-1.5 py-0.2 rounded font-mono font-medium text-[9px] bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-zinc-300">
                                          {b.wordDetail.pos}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {b.wordDetail.definition && (
                                    <p
                                      className={`font-semibold text-xs leading-relaxed ${
                                        isLight ? "text-slate-800" : "text-zinc-200"
                                      }`}
                                    >
                                      {b.wordDetail.definition}
                                    </p>
                                  )}

                                  {b.wordDetail.examples && b.wordDetail.examples.length > 0 && (
                                    <div className="pt-0.5 space-y-0.5">
                                      {b.wordDetail.examples.slice(0, 2).map((ex, exIdx) => (
                                        <p
                                          key={exIdx}
                                          className="text-[10px] text-slate-500 dark:text-zinc-400 leading-normal"
                                        >
                                          • {ex}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* 2. AI 重点词汇拆解 */}
                              {hasDeepAnalysis &&
                                b.deepAnalysis?.vocabulary &&
                                b.deepAnalysis.vocabulary.length > 0 && (
                                  <div
                                    className={`space-y-1.5 ${
                                      hasWordDetail ? "pt-1.5 border-t border-slate-200/60 dark:border-white/[0.06]" : ""
                                    }`}
                                  >
                                    <div className="text-[10px] font-semibold text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                                      <span>📚</span>
                                      <span>重点词汇拆解</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-1">
                                      {b.deepAnalysis.vocabulary.slice(0, 3).map((v, vIdx) => (
                                        <div
                                          key={vIdx}
                                          className={`p-1.5 rounded-lg border flex items-center justify-between gap-1 text-[10.5px] ${
                                            isLight
                                              ? "bg-white/90 border-slate-200/70 text-slate-700"
                                              : "bg-white/[0.02] border-white/[0.05] text-zinc-300"
                                          }`}
                                        >
                                          <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                                            <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                              {v.word}
                                            </span>
                                            {v.phonetic && (
                                              <span className="text-[9px] font-mono opacity-70">
                                                {v.phonetic}
                                              </span>
                                            )}
                                            {v.pos && (
                                              <span className="text-[8.5px] px-1 py-0.2 rounded bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-zinc-300">
                                                {v.pos}
                                              </span>
                                            )}
                                            <span className="opacity-85 truncate text-[10px]">
                                              {v.meaning}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              {/* 3. AI 地道例句 */}
                              {hasDeepAnalysis &&
                                b.deepAnalysis?.examples &&
                                b.deepAnalysis.examples.length > 0 && (
                                  <div className="pt-1.5 border-t border-slate-200/60 dark:border-white/[0.06] space-y-1">
                                    <div className="text-[10px] font-semibold text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                                      <span>💡</span>
                                      <span>语境场景例句</span>
                                    </div>
                                    <div className="space-y-1 text-[10px]">
                                      {b.deepAnalysis.examples.slice(0, 2).map((ex, exIdx) => (
                                        <div
                                          key={exIdx}
                                          className={`p-1.5 rounded-lg border ${
                                            isLight
                                              ? "bg-white/70 border-slate-200/60 text-slate-700"
                                              : "bg-white/[0.02] border-white/[0.05] text-zinc-300"
                                          }`}
                                        >
                                          <p className="font-medium text-slate-800 dark:text-zinc-200">
                                            {ex.en || (ex as any).original}
                                          </p>
                                          <p className="opacity-75 text-slate-500 dark:text-zinc-400 mt-0.5">
                                            {ex.zh || (ex as any).translated}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── 首页同款：精简多引擎胶囊卡片（横向滑动流，严格过滤报错，点击秒切主译） ── */}
                    {b.engineOptions && b.engineOptions.length > 1 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-white/[0.05]">
                        <div className="flex items-center justify-between text-[10px] mb-1.5 text-slate-400 dark:text-zinc-500 font-medium select-none">
                          <span className="flex items-center gap-1">
                            <Zap className="w-3 h-3 text-amber-500" />
                            <span>多引擎参考 ({b.engineOptions.length}) · 点击可切换主译</span>
                          </span>
                        </div>
                        <div
                          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 select-none"
                          data-testid="multi-engine-scroll-row"
                        >
                          {b.engineOptions.map((opt, optIdx) => {
                            const isSelected =
                              (b.selectedEngineName || b.sourceTier) === opt.engineName ||
                              b.translated === opt.translated;
                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() => handleSwitchEngine(i, opt)}
                                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10.5px] transition-all cursor-pointer select-none active:scale-95 outline-none focus:outline-none ${
                                  isSelected
                                    ? isLight
                                      ? "bg-indigo-50 border-indigo-300 text-indigo-700 shadow-2xs font-bold ring-1 ring-indigo-400/30"
                                      : "bg-indigo-500/20 border-indigo-500/50 text-indigo-200 shadow-2xs font-bold ring-1 ring-indigo-500/40"
                                    : isLight
                                      ? "bg-slate-100/80 hover:bg-slate-200/70 text-slate-600 border-slate-200/80 font-medium"
                                      : "bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 border-white/[0.06] font-medium"
                                }`}
                                title={`点击切换为主译文\n【${opt.engineName}】：${opt.translated}`}
                                data-testid={`engine-option-${optIdx}`}
                              >
                                <span className="truncate max-w-[140px]">
                                  {opt.engineName}
                                </span>
                                {isSelected && (
                                  <Check className="w-3 h-3 text-indigo-500 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 兼容兜底：若未提供 engineOptions 则降级渲染平铺候选 */}
                    {!b.engineOptions && b.alternatives && b.alternatives.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-white/[0.04] flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          className={
                            isLight ? "text-slate-400 font-medium" : "text-zinc-500 font-medium"
                          }
                        >
                          其他参考:
                        </span>
                        {b.alternatives.map((alt, altIdx) => (
                          <span
                            key={altIdx}
                            onClick={() => {
                              const cleanAlt = alt.replace(/\s*\([^)]*\)$/, "");
                              navigator.clipboard.writeText(cleanAlt).catch(() => undefined);
                            }}
                            className={`px-1.5 py-0.5 rounded cursor-pointer transition select-text ${
                              isLight
                                ? "bg-slate-100 hover:bg-slate-200/80 text-slate-700"
                                : "bg-white/[0.06] hover:bg-white/10 text-zinc-300"
                            }`}
                            title="点击复制此参考译文"
                          >
                            {alt}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 快捷操作栏：复制、追问、朗读 */}
                    <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-white/[0.05] flex items-center justify-between text-[10.5px]">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleCopyBlock(b.translated || b.original, i)}
                          className={`rounded-md px-2 py-0.5 transition cursor-pointer flex items-center gap-1 active:scale-95 ${
                            copiedBlockIdx === i
                              ? "text-emerald-500 font-bold bg-emerald-50 dark:bg-emerald-500/10"
                              : isLight
                                ? "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                                : "text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                          }`}
                          title="复制此条译文"
                        >
                          {copiedBlockIdx === i ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedBlockIdx === i ? "已复制" : "复制"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => speakText(b.translated || b.original)}
                          className={`rounded-md px-1.5 py-0.5 transition cursor-pointer flex items-center gap-1 active:scale-95 ${
                            isLight
                              ? "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              : "text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                          }`}
                          title="朗读译文"
                        >
                          <Volume2 className="w-3 h-3" />
                          <span>朗读</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setChatContextTerm(b.original || b.translated);
                          setActiveTab("chat");
                        }}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-all duration-200 cursor-pointer flex items-center gap-1 shadow-2xs active:scale-95 ${
                          isLight
                            ? "text-indigo-600 bg-indigo-50/90 hover:bg-indigo-100/90 border border-indigo-200/80"
                            : "text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30"
                        }`}
                        title="💬 切换至 AI 对话深度追问该术语"
                        data-testid="pin-pursuit-btn"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>追问</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {isTranslating && (
            <div className="flex justify-start">
              <div
                className={`flex items-center gap-2 rounded-2xl rounded-tl-xs px-3.5 py-2 text-xs shadow-xs ${
                  isLight
                    ? "bg-white border border-slate-200 text-slate-600"
                    : "bg-white/[0.05] border border-white/[0.08] text-zinc-300"
                }`}
              >
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                <span>正在多引擎竞赛翻译中…</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* 底部查词输入栏：浮岛式晶体输入框 */}
      {!collapsed && activeTab === "translate" && (
        <div
          className={`shrink-0 border-t px-3 py-2.5 transition-colors ${
            isLight
              ? "border-slate-200/70 bg-slate-50/75 backdrop-blur-md"
              : "border-white/[0.06] bg-black/30 backdrop-blur-md"
          }`}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) void executeRaceTranslation(query.trim());
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex flex-1 items-center">
              <Search
                className={`absolute left-3 w-3.5 h-3.5 pointer-events-none transition-colors ${
                  query
                    ? "text-indigo-500"
                    : isLight
                      ? "text-slate-400"
                      : "text-zinc-500"
                }`}
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    void handleClose();
                  }
                }}
                placeholder="输入单词或短语，按 Enter 极速翻译..."
                className={`w-full rounded-xl pl-8.5 pr-14 py-2 text-xs outline-none transition-all ${
                  isLight
                    ? "border border-slate-200/90 bg-white text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 shadow-2xs"
                    : "border border-white/10 bg-white/[0.05] text-zinc-100 placeholder-zinc-500 focus:border-indigo-500/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-indigo-500/25"
                }`}
                data-testid="quick-window-input"
              />
              <div className="absolute right-2 flex items-center gap-1">
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] transition cursor-pointer ${
                      isLight
                        ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        : "text-zinc-400 hover:bg-white/10 hover:text-white"
                    }`}
                    title="清空"
                    data-testid="quick-window-clear"
                  >
                    ✕
                  </button>
                )}
                <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono text-slate-400 dark:text-zinc-500 bg-slate-100/80 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded select-none pointer-events-none">
                  <CornerDownLeft className="w-2.5 h-2.5" />
                </kbd>
              </div>
            </div>

            <button
              type="submit"
              disabled={isTranslating || !query.trim()}
              className="rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-3.5 py-2 text-xs font-semibold text-white transition-all shadow-xs shadow-indigo-500/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0 flex items-center gap-1.5 active:scale-95"
              title="按 Enter 或点击翻译"
              data-testid="quick-window-submit"
            >
              {isTranslating ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>翻译中</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 fill-white/80" />
                  <span>翻译</span>
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* AI 对话模式视图 */}
      {!collapsed && activeTab === "chat" && (
        <PinChatView
          contextTerm={chatContextTerm}
          onClearContextTerm={() => setChatContextTerm(null)}
          fontScale={fontScale}
          isLight={isLight}
        />
      )}

      {/* 底部状态条：呼吸灯 + 缩放指示 + 置顶提示 */}
      {!collapsed && (
        <div
          className={`shrink-0 flex items-center justify-between border-t px-3 py-1.5 text-[10px] select-none cursor-move transition-colors ${
            isLight
              ? "border-slate-200/60 bg-slate-50/80 text-slate-500"
              : "border-white/[0.06] bg-black/20 text-zinc-400"
          }`}
          data-tauri-drag-region
        >
          <div className="flex items-center gap-1.5 min-w-0" data-tauri-drag-region>
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                isPinned
                  ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]"
                  : "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
              } animate-pulse`}
            />
            <span className="truncate font-medium" data-tauri-drag-region>
              {activeTab === "chat"
                ? "💬 AI 对话模式 · 按 Enter 发送"
                : isPinned
                  ? "📌 已常驻置顶"
                  : "💡 失焦即隐 · 按 Esc 关闭"}
            </span>
          </div>

          <div className="shrink-0 flex items-center gap-1 text-[10px] font-mono" data-tauri-drag-region>
            <button
              type="button"
              onClick={() => setFontScale(1)}
              title="点击复位为 1.0x 标准字号 (也可按住 Ctrl+滚轮 缩放)"
              className={`px-1.5 py-0.5 rounded transition cursor-pointer font-medium ${
                isLight
                  ? "text-indigo-600 hover:bg-indigo-50"
                  : "text-indigo-400 hover:bg-white/10"
              }`}
            >
              {fontScale.toFixed(1)}x
            </button>
            <span className="text-slate-400 dark:text-zinc-500" data-tauri-drag-region>
              · Ctrl+滚轮缩放 · 拖拽移动
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
