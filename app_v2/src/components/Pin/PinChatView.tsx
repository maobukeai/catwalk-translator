import React, { useCallback, useEffect, useRef, useState } from "react";
import { cmdChatLlm, cmdChatLlmStream, cmdShowMainWindow } from "../../services/tauri";
import type { ChatMessage, LlmConfig } from "../../services/types";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppTheme } from "../../hooks/useAppTheme";

export const PIN_CHAT_SESSION_KEY = "maobu_pin_chat_session_v1";

export const PIN_PROMPT_PRESETS = [
  {
    id: "ai_translate",
    label: "AI 智能翻译",
    promptPrefix:
      "请作为资深专业翻译专家，将以下内容准确、地道地进行双向翻译（中文译为英文，英文或其它语言译为中文），保留专业术语、代码与格式，直接输出翻译结果：\n",
  },
  {
    id: "polish",
    label: "学术润色",
    promptPrefix: "请将以下文本润色为符合专业学术规范的表达，保留原本专业术语：\n",
  },
  {
    id: "cg_dict",
    label: "CG 术语详解",
    promptPrefix: "请以 3D/CG 资深专家的视角，详细解释以下 3D/CG 节点或材质属性：\n",
  },
  {
    id: "code_comment",
    label: "代码注释",
    promptPrefix: "请将以下代码中的英文注释与变量命名翻译为准确地道的中文：\n",
  },
  {
    id: "rewrite",
    label: "多语境重写",
    promptPrefix:
      "请对以下句子提供 3 种不同风格（正式、日常口语、精简专业）的翻译重写：\n",
  },
] as const;

export const PIN_CONTEXT_ACTIONS = [
  {
    id: "explain",
    label: "📖 解释术语",
    getPrompt: (term: string) =>
      `请以资深专家视角，详细解释专业术语「${term}」的含义、核心应用场景及关键细节。`,
  },
  {
    id: "examples",
    label: "✍️ 3个例句",
    getPrompt: (term: string) =>
      `请为专业术语「${term}」提供 3 个经典场景下的应用例句，并附带地道中文对照。`,
  },
  {
    id: "synonyms",
    label: "🔍 同义辨析",
    getPrompt: (term: string) =>
      `请分析专业术语「${term}」与相近词汇或易混淆概念的区别与应用边界。`,
  },
  {
    id: "grammar",
    label: "🧩 语法拆解",
    getPrompt: (term: string) =>
      `请对专业术语「${term}」进行语法结构拆解、词源背景及常用派生词说明。`,
  },
] as const;

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export interface PinChatViewProps {
  contextTerm?: string | null;
  onClearContextTerm?: () => void;
  fontScale?: number;
  isLight?: boolean;
}

/**
 * 格式化简单 Markdown：
 * - 将 **粗体** 解析为高亮
 * - 将 `代码` 解析为行内代码块
 * - 保留换行符
 */
function renderMarkdownContent(content: string, isLight?: boolean) {
  if (!content) return null;
  const parts = content.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong
              key={index}
              className={`font-semibold ${isLight ? "text-indigo-600" : "text-indigo-300"}`}
            >
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code
              key={index}
              className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
                isLight
                  ? "bg-slate-100 text-indigo-700 border border-slate-200/80"
                  : "bg-white/10 text-indigo-200 border border-white/10"
              }`}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

const DEFAULT_FALLBACK_LLM: LlmConfig = {
  provider: "Ollama",
  apiKey: "",
  model: "qwen2.5:7b",
  endpoint: "http://localhost:11434/v1",
  enabled: true,
};

export function PinChatView({
  contextTerm,
  onClearContextTerm,
  fontScale = 1,
  isLight: propIsLight,
}: PinChatViewProps) {
  const { isLight: hookIsLight } = useAppTheme();
  const isLight = propIsLight ?? hookIsLight;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [collapsedReasoning, setCollapsedReasoning] = useState<Record<string, boolean>>({});

  const abortRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const initializedRef = useRef(false);

  const curSettings = useSettingsStore((s) => s.settings);
  const setLlmConfig = useSettingsStore((s) => s.setLlmConfig);

  const isModelConfigured = (cfg: LlmConfig) =>
    !!cfg.apiKey?.trim() ||
    cfg.endpoint?.includes("localhost") ||
    cfg.endpoint?.includes("127.0.0.1");

  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const pool =
    curSettings.llmConfigs && curSettings.llmConfigs.length > 0
      ? curSettings.llmConfigs
      : curSettings.llmConfig
      ? [curSettings.llmConfig]
      : [];

  const configuredPool = pool.filter(isModelConfigured);

  // 用户手动选择 > 当前已配好的模型 > 模型池中首个已配好的可用模型 > 默认回退
  const rawActive = curSettings.llmConfig;
  const userSelected = selectedModelId
    ? pool.find((c) => (c.id || `${c.provider}-${c.model}`) === selectedModelId)
    : null;

  const activeLlm: LlmConfig =
    userSelected ||
    (rawActive && isModelConfigured(rawActive)
      ? rawActive
      : configuredPool[0] || rawActive || DEFAULT_FALLBACK_LLM);

  const isCurrentConfigured = isModelConfigured(activeLlm);

  // 挂载时从 localStorage 读取会话历史
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIN_CHAT_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
      }
    } catch {
      // 容错降级
    }
    initializedRef.current = true;
  }, []);

  // 消息变更时持久化至 localStorage
  useEffect(() => {
    if (!initializedRef.current) return;
    try {
      if (messages.length === 0) {
        localStorage.removeItem(PIN_CHAT_SESSION_KEY);
      } else {
        localStorage.setItem(PIN_CHAT_SESSION_KEY, JSON.stringify(messages.slice(-30)));
      }
    } catch {
      // 容错降级
    }
  }, [messages]);

  // 自动滚动到消息流底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages, isLoading, streamingId]);

  // 输入框自适应高度 (32px ~ 96px)
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 32), 96)}px`;
    }
  }, [input]);

  // 发送消息核心逻辑
  const handleSend = useCallback(
    async (textToSend?: string) => {
      const rawText = (textToSend || input).trim();
      if (!rawText || isLoading) return;

      const activePreset = PIN_PROMPT_PRESETS.find((p) => p.id === activePresetId);
      const promptPrefix = activePreset ? activePreset.promptPrefix : "";

      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        role: "user",
        content: rawText,
        timestamp: nowTime(),
        mode: activePreset?.label,
      };

      // API Key 缺失校验拦截
      if (!isCurrentConfigured) {
        const warnMsg: ChatMessage = {
          id: `ai_${Date.now() + 1}`,
          role: "assistant",
          content:
            pool.length === 0
              ? `⚠️ 当前未配置 AI 模型。\n\n请在主窗口「设置 -> AI 模型池」中添加大模型配置，或启动本地 Ollama。`
              : `⚠️ 未检测到 **${activeLlm.provider} (${activeLlm.model || "默认模型"})** 的有效 API 密钥。\n\n请在主窗口「设置 -> AI 模型池」中配置 API Key，或在顶部下拉菜单中切换为已配好的其他模型。`,
          timestamp: nowTime(),
          model: activeLlm.model,
        };
        setMessages((prev) => [...prev, userMsg, warnMsg]);
        if (!textToSend) setInput("");
        return;
      }

      const aiMsgId = `ai_${Date.now() + 1}`;
      const aiMsg: ChatMessage = {
        id: aiMsgId,
        role: "assistant",
        content: "",
        timestamp: nowTime(),
        model: activeLlm.model,
      };

      setMessages((prev) => [...prev, userMsg, aiMsg]);
      if (!textToSend) setInput("");
      setIsLoading(true);
      setStreamingId(aiMsgId);
      abortRef.current = false;

      // 准备发往 LLM 的对话上下文
      const effectiveMsgs = [...messages, userMsg];
      const apiMessages = effectiveMsgs.map((m, idx) => {
        if (
          idx === effectiveMsgs.length - 1 &&
          m.role === "user" &&
          promptPrefix &&
          !m.content.startsWith(promptPrefix)
        ) {
          return {
            role: m.role,
            content: `${promptPrefix}${m.content}`,
          };
        }
        return {
          role: m.role,
          content: m.content,
        };
      });

      try {
        let replyText = "";
        let pendingDelta = "";
        let pendingReasoning = "";
        let lastFlushTs = 0;

        const flushDelta = (force = false) => {
          const now = Date.now();
          if (!pendingDelta && !pendingReasoning) return;
          if (!force && now - lastFlushTs < 80) return;
          const chunk = pendingDelta;
          const reasoningChunk = pendingReasoning;
          pendingDelta = "";
          pendingReasoning = "";
          lastFlushTs = now;

          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    content: m.content + chunk,
                    reasoning: (m.reasoning || "") + reasoningChunk,
                  }
                : m
            )
          );
        };

        try {
          replyText = await cmdChatLlmStream(apiMessages, activeLlm, (delta, reasoning) => {
            if (abortRef.current) return;
            if (delta) pendingDelta += delta;
            if (reasoning) pendingReasoning += reasoning;
            flushDelta();
          });
          flushDelta(true);
        } catch (streamErr) {
          if (abortRef.current) return;
          console.warn("Streaming failed in pin chat, falling back to non-stream:", streamErr);
          replyText = await cmdChatLlm(apiMessages, activeLlm);
        }

        if (abortRef.current) return;

        // 如果包含 <think> 思考标签，拆分出思路文本
        let finalContent = replyText;
        let finalReasoning: string | undefined = undefined;
        if (replyText.includes("<think>") && replyText.includes("</think>")) {
          const parts = replyText.split("</think>");
          finalReasoning = parts[0].replace("<think>", "").trim();
          finalContent = parts.slice(1).join("</think>").trim();
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  content: finalContent || m.content,
                  reasoning: finalReasoning || m.reasoning,
                }
              : m
          )
        );
      } catch (err) {
        if (!abortRef.current) {
          console.error("Pin chat error:", err);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    content: `⚠️ 对话请求失败: ${err instanceof Error ? err.message : String(err)}`,
                  }
                : m
            )
          );
        }
      } finally {
        setIsLoading(false);
        setStreamingId(null);
      }
    },
    [input, isLoading, activePresetId, activeLlm, messages]
  );

  // 中断生成
  const handleStop = useCallback(() => {
    abortRef.current = true;
    setIsLoading(false);
    setStreamingId(null);
  }, []);

  // 清空对话
  const handleClear = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(PIN_CHAT_SESSION_KEY);
    if (onClearContextTerm) onClearContextTerm();
  }, [onClearContextTerm]);

  // 复制单条消息
  const handleCopyMessage = useCallback((text: string, msgId: string) => {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId((curr) => (curr === msgId ? null : curr)), 1500);
  }, []);

  // 删除单条消息
  const handleDeleteMessage = useCallback((msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }, []);

  // 切换思考过程折叠
  const toggleReasoning = useCallback((msgId: string) => {
    setCollapsedReasoning((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden text-xs" data-testid="pin-chat-view">
      {/* 顶部状态与工具条：当前模型选择 + 快捷设置 + 清空操作 */}
      <div
        className={`flex flex-wrap items-center justify-between gap-1.5 border-b px-2.5 py-1.5 text-[10.5px] transition-colors ${
          isLight
            ? "border-slate-200/80 bg-slate-50/80 text-slate-700"
            : "border-white/[0.06] bg-black/25 text-zinc-200"
        }`}
      >
        {/* 当前模型选择下拉 / 徽标 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`h-2 w-2 rounded-full shrink-0 transition-all ${
              isCurrentConfigured
                ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.55)]"
                : "bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.6)]"
            }`}
            title={isCurrentConfigured ? "当前模型已配置有效 API Key" : "当前模型缺少 API Key"}
          />
          {pool.length > 1 ? (
            <select
              value={activeLlm.id || `${activeLlm.provider}-${activeLlm.model}`}
              onChange={(e) => {
                const target = pool.find(
                  (c) => (c.id || `${c.provider}-${c.model}`) === e.target.value
                );
                if (target) {
                  setSelectedModelId(target.id || `${target.provider}-${target.model}`);
                  setLlmConfig(target);
                }
              }}
              className={`rounded-lg px-2 py-0.5 outline-none font-sans text-[10.5px] cursor-pointer transition max-w-[200px] truncate ${
                isLight
                  ? "bg-white hover:bg-slate-50 text-slate-800 border border-slate-200/90 shadow-xs"
                  : "bg-white/[0.08] hover:bg-white/[0.12] text-zinc-200 border border-white/10"
              }`}
              title="切换当前使用的大模型"
              data-testid="pin-chat-model-select"
            >
              {pool.map((cfg) => {
                const val = cfg.id || `${cfg.provider}-${cfg.model}`;
                const hasKey = isModelConfigured(cfg);
                return (
                  <option
                    key={val}
                    value={val}
                    className={isLight ? "bg-white text-slate-800" : "bg-[#181a20] text-zinc-200"}
                  >
                    {cfg.provider}: {cfg.model || "默认"} {hasKey ? "" : "(未配Key)"}
                  </option>
                );
              })}
            </select>
          ) : (
            <span
              className={`font-semibold font-mono truncate max-w-[170px] ${
                isLight ? "text-slate-800" : "text-zinc-200"
              }`}
              title={`提供商: ${activeLlm.provider} | 端点: ${activeLlm.endpoint}`}
            >
              {activeLlm.provider}: {activeLlm.model || "默认模型"}
            </span>
          )}

          {!isCurrentConfigured && (
            <button
              type="button"
              onClick={() => void cmdShowMainWindow()}
              className={`rounded-md px-1.5 py-0.5 text-[10px] flex items-center gap-1 shrink-0 transition cursor-pointer font-medium ${
                isLight
                  ? "bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 shadow-xs"
                  : "bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25"
              }`}
              title="未检测到 API 密钥，点击打开主窗口配置"
            >
              <span>⚠️ 去配Key</span>
            </button>
          )}
        </div>

        {/* 右侧工具栏：设置 + 清空 */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => void cmdShowMainWindow()}
            className={`rounded-md px-1.5 py-0.5 cursor-pointer text-[10.5px] transition ${
              isLight
                ? "text-slate-500 hover:bg-slate-200/60 hover:text-slate-900"
                : "text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            }`}
            title="打开主窗口配置模型"
            data-testid="pin-chat-open-settings"
          >
            ⚙️ 设置
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={messages.length === 0 && !contextTerm}
            className={`rounded-md px-1.5 py-0.5 transition disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer text-[10.5px] ${
              isLight
                ? "text-slate-500 hover:bg-red-50 hover:text-red-600"
                : "text-zinc-400 hover:bg-white/10 hover:text-rose-300"
            }`}
            title="清空对话记录"
            data-testid="pin-chat-clear"
          >
            🗑️ 清空
          </button>
        </div>
      </div>

      {/* 快捷提示词预设 Chips */}
      <div
        className={`scrollbar-none flex items-center gap-1.5 overflow-x-auto border-b px-3 py-1.5 text-[10.5px] transition-colors ${
          isLight
            ? "border-slate-200/70 bg-slate-50/40 text-slate-500"
            : "border-white/[0.04] bg-white/[0.01] text-zinc-500"
        }`}
      >
        <span className={`shrink-0 font-medium ${isLight ? "text-slate-400" : "text-zinc-500"}`}>
          预设:
        </span>
        {PIN_PROMPT_PRESETS.map((p) => {
          const isSelected = activePresetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setActivePresetId(isSelected ? null : p.id)}
              className={`shrink-0 rounded-full px-2.5 py-0.5 transition cursor-pointer ${
                isSelected
                  ? "bg-indigo-600/90 font-medium text-white shadow-xs"
                  : isLight
                    ? "bg-slate-100/90 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 border border-slate-200/60"
                    : "bg-white/[0.04] text-zinc-400 hover:bg-white/10 hover:text-zinc-200 border border-white/[0.06]"
              }`}
              title={p.promptPrefix}
              data-testid={`pin-preset-${p.id}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* 翻译术语引流胶囊（当从翻译卡片点击「💬 追问」跳转来时展示） */}
      {contextTerm && (
        <div
          className={`flex flex-col gap-1 border-b px-3 py-1.5 transition-colors ${
            isLight
              ? "border-indigo-100 bg-indigo-50/80 text-indigo-950"
              : "border-indigo-500/20 bg-indigo-950/20 text-indigo-200"
          }`}
          data-testid="context-term-banner"
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className={isLight ? "text-indigo-900" : "text-indigo-300"}>
              💬 针对当前术语追问：<strong className={isLight ? "text-indigo-700 font-bold" : "text-white font-bold"}>「{contextTerm}」</strong>
            </span>
            {onClearContextTerm && (
              <button
                type="button"
                onClick={onClearContextTerm}
                className={`cursor-pointer text-[10px] p-0.5 rounded ${
                  isLight
                    ? "text-slate-400 hover:text-slate-700 hover:bg-indigo-100"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/10"
                }`}
                title="关闭术语提示"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {PIN_CONTEXT_ACTIONS.map((act) => (
              <button
                key={act.id}
                type="button"
                onClick={() => void handleSend(act.getPrompt(contextTerm))}
                disabled={isLoading}
                className={`rounded-md border px-2 py-0.5 text-[10.5px] transition disabled:opacity-40 cursor-pointer font-medium ${
                  isLight
                    ? "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 shadow-xs"
                    : "border-indigo-500/30 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/30 hover:text-white"
                }`}
                data-testid={`context-action-${act.id}`}
              >
                {act.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 对话消息流滚动列表 */}
      <div
        className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-3 py-2.5"
        style={{ fontSize: `${11.5 * fontScale}px` }}
        data-testid="pin-chat-messages"
      >
        {messages.length === 0 && !contextTerm && (
          <div className="relative flex h-full flex-col items-center justify-center py-10 text-center select-none overflow-hidden">
            <div className="pointer-events-none absolute -top-4 h-40 w-40 rounded-full bg-gradient-to-tr from-indigo-500/10 via-purple-500/10 to-transparent blur-2xl" />
            <div
              className={`relative flex h-12 w-12 items-center justify-center rounded-2xl mb-2.5 shadow-sm transition-transform duration-300 hover:scale-105 ${
                isLight
                  ? "bg-gradient-to-br from-indigo-50 to-white text-indigo-600 border border-indigo-200/60 shadow-indigo-500/10"
                  : "bg-gradient-to-br from-indigo-500/20 to-purple-900/20 text-indigo-300 border border-indigo-500/25 shadow-black/40"
              }`}
            >
              <span className="text-xl">💬</span>
            </div>
            <p
              className={`text-xs font-bold tracking-tight ${
                isLight ? "text-slate-800" : "text-zinc-100"
              }`}
            >
              猫步悬浮 AI 对话
            </p>
            <p
              className={`mt-1 text-[11px] max-w-[260px] leading-relaxed ${
                isLight ? "text-slate-500" : "text-zinc-400"
              }`}
            >
              输入您的问题，或在上方选择「AI 智能翻译」、「学术润色」等预设模式极速探索
            </p>
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === "user";
          const isStreamingMsg = streamingId === m.id;
          const isReasoningOpen = !collapsedReasoning[m.id];

          return (
            <div
              key={m.id}
              className={`flex flex-col group ${isUser ? "items-end" : "items-start"}`}
            >
              {/* 气泡顶栏信息 */}
              <div
                className={`flex items-center gap-1.5 px-1 py-0.5 text-[9.5px] ${
                  isLight ? "text-slate-400" : "text-zinc-500"
                }`}
              >
                <span className={`font-medium ${isLight ? "text-slate-600" : "text-zinc-400"}`}>
                  {isUser ? "👤 我" : `🤖 ${m.model || activeLlm.model || "AI"}`}
                </span>
                {m.mode && (
                  <span
                    className={`rounded px-1.5 py-0.2 text-[9px] font-medium ${
                      isLight
                        ? "bg-indigo-50 border border-indigo-200/60 text-indigo-600"
                        : "bg-indigo-500/20 text-indigo-300"
                    }`}
                  >
                    {m.mode}
                  </span>
                )}
                <span>{m.timestamp}</span>
              </div>

              {/* 思考过程（DeepSeek R1 等） */}
              {m.reasoning && (
                <div
                  className={`mb-1 max-w-[92%] rounded-xl p-2 text-[10px] transition-colors ${
                    isLight
                      ? "border border-purple-200 bg-purple-50/80 text-purple-900"
                      : "border border-purple-500/20 bg-purple-950/20 text-purple-300"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleReasoning(m.id)}
                    className={`flex items-center gap-1 font-mono font-medium cursor-pointer ${
                      isLight
                        ? "text-purple-700 hover:text-purple-900"
                        : "text-purple-400 hover:text-purple-200"
                    }`}
                  >
                    <span>💭 深度思考</span>
                    <span className="text-[9px]">{isReasoningOpen ? "▼ 收起" : "▶ 展开"}</span>
                  </button>
                  {isReasoningOpen && (
                    <div
                      className={`mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap font-sans leading-relaxed border-t pt-1 ${
                        isLight
                          ? "border-purple-200/80 text-purple-900/80"
                          : "border-purple-500/10 text-purple-200/80"
                      }`}
                    >
                      {m.reasoning}
                    </div>
                  )}
                </div>
              )}

              {/* 消息正文气泡 */}
              <div
                className={`relative max-w-[92%] rounded-2xl px-3 py-2 leading-relaxed break-words select-text transition-colors ${
                  isUser
                    ? "bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-xs shadow-md shadow-indigo-500/15"
                    : isLight
                      ? "bg-white border border-slate-200/85 text-slate-800 rounded-tl-xs shadow-xs"
                      : "bg-white/[0.05] border border-white/10 text-zinc-100 rounded-tl-xs shadow"
                }`}
              >
                {/* 纯文本与粗体解析渲染 */}
                <div className="whitespace-pre-wrap">
                  {renderMarkdownContent(m.content, isLight)}
                  {isStreamingMsg && (
                    <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-indigo-500 animate-pulse align-middle" />
                  )}
                </div>

                {/* 提示缺少 Key 时的直达按钮 */}
                {!isUser && m.content.includes("未检测到") && (
                  <div
                    className={`mt-2 pt-2 border-t flex items-center gap-2 ${
                      isLight ? "border-slate-100" : "border-white/10"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void cmdShowMainWindow()}
                      className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 text-[10.5px] text-white font-medium cursor-pointer transition shadow-xs flex items-center gap-1"
                    >
                      <span>⚙️ 前往主窗口配置 Key</span>
                    </button>
                  </div>
                )}

                {/* 悬浮操作按钮 */}
                <div
                  className={`absolute -bottom-2.5 ${
                    isUser ? "left-1" : "right-1"
                  } flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] opacity-0 shadow transition group-hover:opacity-100 ${
                    isLight
                      ? "bg-white border border-slate-200 text-slate-600 shadow-md"
                      : "bg-black/80 border border-white/10 text-zinc-400 backdrop-blur"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleCopyMessage(m.content, m.id)}
                    className={`cursor-pointer px-0.5 transition ${
                      isLight ? "hover:text-slate-900" : "hover:text-white"
                    }`}
                    title="复制消息"
                  >
                    {copiedMsgId === m.id ? "✓" : "📋"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteMessage(m.id)}
                    className="hover:text-rose-500 cursor-pointer px-0.5 transition"
                    title="删除消息"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入与操作条：浮岛式晶体输入框 */}
      <div
        className={`shrink-0 border-t px-3 py-2.5 transition-colors ${
          isLight ? "border-slate-200/70 bg-slate-50/75 backdrop-blur-md" : "border-white/[0.06] bg-black/30 backdrop-blur-md"
        }`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim() && !isLoading) {
              void handleSend();
            }
          }}
          className="flex items-end gap-2"
        >
          <div className="relative flex flex-1 items-center">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !isLoading) {
                    void handleSend();
                  }
                }
              }}
              placeholder={
                activePresetId
                  ? `[${PIN_PROMPT_PRESETS.find((p) => p.id === activePresetId)?.label}] 输入内容，Enter 发送...`
                  : "输入问题或指令，按 Enter 发送 (Shift+Enter 换行)..."
              }
              className={`scrollbar-none w-full resize-none rounded-xl px-3 py-2 text-xs outline-none transition-all ${
                isLight
                  ? "border border-slate-200/90 bg-white text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 shadow-2xs"
                  : "border border-white/10 bg-white/[0.04] text-zinc-100 placeholder-zinc-500 focus:border-indigo-500/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-indigo-500/25"
              }`}
              data-testid="pin-chat-input"
            />
          </div>

          {isLoading ? (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-xl bg-rose-600 hover:bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white transition-all cursor-pointer shrink-0 shadow-xs active:scale-95"
              title="中断当前生成"
              data-testid="pin-chat-stop"
            >
              ■ 停止
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-3.5 py-2 text-xs font-semibold text-white transition-all shadow-xs shadow-indigo-500/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0 flex items-center gap-1 active:scale-95"
              title="发送消息 (Enter)"
              data-testid="pin-chat-send"
            >
              <span>发送</span>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
