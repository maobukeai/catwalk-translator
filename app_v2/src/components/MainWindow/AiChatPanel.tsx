import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Bot,
  Send,
  Trash2,
  Copy,
  Check,
  Languages,
  Sparkles,
  BookOpen,
  Code,
  FileText,
  AlertCircle,
  X,
  SquarePen,
  MessageSquare,
  ChevronDown,
  BrainCircuit,
  RotateCcw,
  History,
  Download,
  Pencil,
  Square,
  ArrowDown,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { GlassSelect } from '../Common/GlassSelect';
import type { ChatMessage, LlmConfig } from '../../services/types';
import { cmdChatLlm, cmdChatLlmStream } from '../../services/tauri';

interface AiChatPanelProps {
  initialPrompt?: string;
  onOpenSettings?: () => void;
}

const AI_TRANSLATE_LANGUAGES = [
  { code: 'auto', name: '🌐 中英双向互译 (自动识别)', shortName: '中英互译' },
  { code: 'zh-CN', name: '🇨🇳 简体中文 (Chinese)', shortName: '简体中文' },
  { code: 'zh-TW', name: '🇭🇰 繁体中文 (Traditional)', shortName: '繁体中文' },
  { code: 'en', name: '🇺🇸 英语 (English)', shortName: '英语' },
  { code: 'ja', name: '🇯🇵 日语 (日本語)', shortName: '日语' },
  { code: 'ko', name: '🇰🇷 韩语 (한국어)', shortName: '韩语' },
  { code: 'fr', name: '🇫🇷 法语 (Français)', shortName: '法语' },
  { code: 'de', name: '🇩🇪 德语 (Deutsch)', shortName: '德语' },
  { code: 'es', name: '🇪🇸 西班牙语 (Español)', shortName: '西班牙语' },
  { code: 'ru', name: '🇷🇺 俄语 (Русский)', shortName: '俄语' },
  { code: 'it', name: '🇮🇹 意大利语 (Italiano)', shortName: '意大利语' },
  { code: 'pt', name: '🇵🇹 葡萄牙语 (Português)', shortName: '葡萄牙语' },
  { code: 'nl', name: '🇳🇱 荷兰语 (Nederlands)', shortName: '荷兰语' },
  { code: 'pl', name: '🇵🇱 波兰语 (Polski)', shortName: '波兰语' },
  { code: 'ar', name: '🇸🇦 阿拉伯语 (العربية)', shortName: '阿拉伯语' },
  { code: 'th', name: '🇹🇭 泰语 (ไทย)', shortName: '泰语' },
  { code: 'vi', name: '🇻🇳 越南语 (Tiếng Việt)', shortName: '越南语' },
  { code: 'id', name: '🇮🇩 印尼语 (Bahasa Indonesia)', shortName: '印尼语' },
  { code: 'tr', name: '🇹🇷 土耳其语 (Türkçe)', shortName: '土耳其语' },
  { code: 'hi', name: '🇮🇳 印地语 (हिन्दी)', shortName: '印地语' },
  { code: 'uk', name: '🇺🇦 乌克兰语 (Українська)', shortName: '乌克兰语' },
  { code: 'sv', name: '🇸🇪 瑞典语 (Svenska)', shortName: '瑞典语' },
  { code: 'cs', name: '🇨🇿 捷克语 (Čeština)', shortName: '捷克语' },
  { code: 'el', name: '🇬🇷 希腊语 (Ελληνικά)', shortName: '希腊语' },
  { code: 'he', name: '🇮🇱 希伯来语 (עברית)', shortName: '希伯来语' },
  { code: 'da', name: '🇩🇰 丹麦语 (Dansk)', shortName: '丹麦语' },
  { code: 'fi', name: '🇫🇮 芬兰语 (Suomi)', shortName: '芬兰语' },
  { code: 'no', name: '🇳🇴 挪威语 (Norsk)', shortName: '挪威语' },
  { code: 'hu', name: '🇭🇺 匈牙利语 (Magyar)', shortName: '匈牙利语' },
  { code: 'ro', name: '🇷🇴 罗马尼亚语 (Română)', shortName: '罗马尼亚语' },
] as const;

const PROMPT_PRESETS = [
  {
    id: 'ai_translate',
    label: 'AI 智能翻译',
    promptPrefix: '请作为资深专业翻译专家，将以下内容准确、地道地进行双向翻译（中文译为英文，英文或其它语言译为中文），保留专业术语、代码与格式，直接输出翻译结果：\n',
    icon: Languages,
  },
  {
    id: 'polish',
    label: '学术润色',
    promptPrefix: '请将以下文本润色为符合专业学术规范的表达，保留原本专业术语：\n',
    icon: Sparkles,
  },
  {
    id: 'cg_dict',
    label: 'CG 术语详解',
    promptPrefix: '请以 3D/CG 资深专家的视角，详细解释以下 3D/CG 节点或材质属性：\n',
    icon: BookOpen,
  },
  {
    id: 'code_comment',
    label: '代码注释翻译',
    promptPrefix: '请将以下代码中的英文注释与变量命名翻译为准确地道的中文：\n',
    icon: Code,
  },
  {
    id: 'rewrite',
    label: '多语境重写',
    promptPrefix: '请对以下句子提供 3 种不同风格（正式、日常口语、精简专业）的翻译重写：\n',
    icon: FileText,
  },
] as const;

/* ── 会话持久化（localStorage，轻量不侵入 Rust 状态） ──────────────────── */

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const SESSIONS_KEY = 'maobu_chat_sessions_v1';
const MAX_SESSIONS = 30;

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_SESSIONS) : [];
  } catch {
    return [];
  }
}

function persistSessions(sessions: ChatSession[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    /* 存储满/隐私模式时静默降级为内存会话 */
  }
}

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function sessionDisplayTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 格式化简单 Markdown（将 **bold** 渲染为高亮节点，将 - 渲染为列表项）。
 * React.memo：流式输出期间 delta 只重渲染正在生成的消息，
 * 其余已完成消息 props 不变直接跳过（30 会话列表不再全量重算）。
 */
const FormattedContent = React.memo(function FormattedContent({
  text,
  isLight,
  streaming,
}: {
  text: string;
  isLight: boolean;
  streaming: boolean;
}) {
  const lines = text.split('\n');
  const nodes = (
    <div className="space-y-1.5 select-text text-[14.5px] leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
        const contentStr = isBullet ? trimmed.substring(2) : line;

        const parts = contentStr.split(/(\*\*.*?\*\*)/g);
        const lineNodes = parts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
            return (
              <span
                key={pIdx}
                className={`font-bold px-1.5 py-0.5 rounded font-mono mx-0.5 ${
                  isLight
                    ? 'text-blue-700 bg-blue-500/10 border border-blue-300/50'
                    : 'text-sky-300 bg-sky-500/15 border border-sky-400/30'
                }`}
              >
                {part.slice(2, -2)}
              </span>
            );
          }
          return part;
        });

        if (isBullet) {
          return (
            <div key={idx} className="flex items-start space-x-2 my-1 pl-1">
              <span className="shrink-0 mt-0.5 text-xs" style={{ color: 'var(--accent-text)' }}>•</span>
              <span className="flex-1">{lineNodes}</span>
            </div>
          );
        }

        return (
          <div key={idx} className={trimmed === '' ? 'h-2' : 'min-h-[1.35rem]'}>
            {lineNodes}
          </div>
        );
      })}
    </div>
  );
  return streaming ? <span className="stream-caret">{nodes}</span> : nodes;
});

export const AiChatPanel: React.FC<AiChatPanelProps> = ({ initialPrompt = '', onOpenSettings }) => {
  const { settings, setLlmConfig } = useSettingsStore();
  const { isLight } = useAppTheme();

  const llm = settings.llmConfig || {
    provider: 'DeepSeek',
    apiKey: '',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1',
  };

  const isModelConfigured = (cfg: LlmConfig) =>
    !!cfg.apiKey?.trim() || cfg.endpoint?.includes('localhost') || cfg.endpoint?.includes('127.0.0.1');

  const configuredLlmConfigs = (settings.llmConfigs || []).filter(isModelConfigured);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState(initialPrompt);
  const [activePresetLabel, setActivePresetLabel] = useState<string | null>(null);
  const [translateTargetLang, setTranslateTargetLang] = useState<string>('auto');
  const [loading, setLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState('');
  const [enableContext, setEnableContext] = useState(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const abortRef = useRef(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initializedRef = useRef(false);

  // 输入框高度随输入内容轻量自适应（36px ~ 120px）
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 36), 120)}px`;
    }
  }, [input]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (loading) {
      setWaitingSeconds(0);
      timer = setInterval(() => {
        setWaitingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setWaitingSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [loading]);

  // 挂载时载入持久化会话
  useEffect(() => {
    const loaded = loadSessions();
    if (loaded.length > 0) {
      setSessions(loaded);
      setActiveSessionId(loaded[0].id);
    }
    initializedRef.current = true;
  }, []);

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId) || null
    : null;
  const messages = activeSession?.messages ?? [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 120);
  };

  const toggleReasoningCollapse = (msgId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== activeSessionId
          ? s
          : {
              ...s,
              messages: s.messages.map((m) => {
                if (m.id !== msgId) return m;
                const isMsgStreaming = streamingId === m.id;
                const defaultCollapsed = !isMsgStreaming || !!m.content;
                const currentCollapsed = m.isReasoningCollapsed !== undefined
                  ? m.isReasoningCollapsed
                  : defaultCollapsed;
                return { ...m, isReasoningCollapsed: !currentCollapsed };
              }),
            }
      )
    );
  };

  const handleStopGeneration = () => {
    abortRef.current = true;
    setLoading(false);
    setStreamingId(null);
  };

  const handleDeleteMessage = (msgId: string) => {
    if (!activeSessionId) return;
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id !== activeSessionId
          ? s
          : {
              ...s,
              messages: s.messages.filter((m) => m.id !== msgId),
            }
      );
      if (initializedRef.current) persistSessions(next);
      return next;
    });
  };

  const handleEditUserMessage = (text: string) => {
    setInput(text);
  };

  const handleExportMarkdown = () => {
    if (!activeSession || messages.length === 0) return;
    let md = `# ${activeSession.title || 'AI 对话记录'}\n\n`;
    md += `> 导出时间: ${new Date().toLocaleString()} | 模型: ${llm.provider} (${llm.model || '默认'})\n\n---\n\n`;
    for (const m of messages) {
      if (m.role === 'user') {
        md += `### 👤 我 (${m.timestamp})\n\n${m.content}\n\n`;
      } else {
        md += `### 🤖 ${m.model || llm.provider} (${m.timestamp})\n\n`;
        if (m.reasoning) {
          md += `<details><summary>💭 深度思考过程 (点击展开)</summary>\n\n\`\`\`\n${m.reasoning}\n\`\`\`\n\n</details>\n\n`;
        }
        md += `${m.content}\n\n`;
      }
      md += `---\n\n`;
    }

    navigator.clipboard.writeText(md).then(() => {
      alert('已将当前完整对话复制为 Markdown 格式到剪贴板！');
    });
  };

  const handleDeleteSession = (sessId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = sessions.filter((s) => s.id !== sessId);
    setSessions(next);
    if (initializedRef.current) persistSessions(next);
    if (activeSessionId === sessId) {
      if (next.length > 0) {
        setActiveSessionId(next[0].id);
      } else {
        handleNewSession();
      }
    }
  };

  const handleStartRenameSession = (sess: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(sess.id);
    setEditingSessionTitle(sess.title);
  };

  const handleSaveRenameSession = (sessId: string) => {
    if (!editingSessionTitle.trim()) {
      setEditingSessionId(null);
      return;
    }
    const next = sessions.map((s) =>
      s.id === sessId ? { ...s, title: editingSessionTitle.trim() } : s
    );
    setSessions(next);
    persistSessions(next);
    setEditingSessionId(null);
  };

  /** 更新当前会话（无则创建），并持久化 */
  const upsertSession = useCallback((
    sessionId: string | null,
    updater: (msgs: ChatMessage[], session: ChatSession) => ChatMessage[]
  ): { sessions: ChatSession[]; activeId: string } => {
    let nextSessions: ChatSession[];
    let activeId: string;
    if (sessionId && sessions.some((s) => s.id === sessionId)) {
      nextSessions = sessions.map((s) => {
        if (s.id !== sessionId) return s;
        const nextMsgs = updater(s.messages, s);
        return { ...s, messages: nextMsgs, updatedAt: Date.now() };
      });
      activeId = sessionId;
    } else {
      const newSession: ChatSession = {
        id: `sess_${Date.now()}`,
        title: '新对话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      const nextMsgs = updater(newSession.messages, newSession);
      newSession.messages = nextMsgs;
      if (nextMsgs.length > 0 && newSession.title === '新对话') {
        const firstUser = nextMsgs.find((m) => m.role === 'user');
        if (firstUser) newSession.title = firstUser.content.slice(0, 18) || '新对话';
      }
      nextSessions = [newSession, ...sessions.filter((s) => s.id !== newSession.id)];
      activeId = newSession.id;
    }
    nextSessions = nextSessions.slice(0, MAX_SESSIONS);
    setSessions(nextSessions);
    setActiveSessionId(activeId);
    if (initializedRef.current) persistSessions(nextSessions);
    return { sessions: nextSessions, activeId };
  }, [sessions]);

  const handleSend = async (textToSend?: string) => {
    const rawText = (textToSend || input).trim();
    if (!rawText || loading) return;

    setErrorMsg(null);

    // 若输入的内容包含了预设提示词，自动清洗提取纯净的用户内容展示在气泡中
    let displayContent = rawText;
    for (const p of PROMPT_PRESETS) {
      if (displayContent.startsWith(p.promptPrefix)) {
        displayContent = displayContent.slice(p.promptPrefix.length).trimStart();
      }
    }
    if (!displayContent) displayContent = rawText;

    const currentPreset = PROMPT_PRESETS.find((p) => p.label === activePresetLabel);
    let dynamicPromptPrefix = currentPreset?.promptPrefix || '';
    let modeBadge = activePresetLabel || undefined;

    if (activePresetLabel === 'AI 智能翻译') {
      const selectedLang = AI_TRANSLATE_LANGUAGES.find((l) => l.code === translateTargetLang);
      if (translateTargetLang === 'auto') {
        dynamicPromptPrefix = '请作为资深专业翻译专家，将以下内容准确、地道地进行双向翻译（中文译为英文，英文或其它语言译为中文），保留专业术语、代码与排版格式，直接输出翻译结果：\n';
        modeBadge = '🌐 AI 智能翻译 (双向)';
      } else {
        dynamicPromptPrefix = `请作为资深专业翻译专家，将以下内容准确、地道地翻译为【${selectedLang?.name || translateTargetLang}】，保留专业术语、代码与排版格式，直接输出翻译结果：\n`;
        modeBadge = `🌐 AI 翻译 → ${selectedLang?.shortName || translateTargetLang}`;
      }
    }

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: displayContent,
      timestamp: nowTime(),
      mode: modeBadge,
    };

    // Pre-flight check for missing API Key
    const isLocalEndpoint = llm.endpoint.includes('localhost') || llm.endpoint.includes('127.0.0.1');
    if (!llm.apiKey && !isLocalEndpoint) {
      const warnMsg: ChatMessage = {
        id: `ai_${Date.now() + 1}`,
        role: 'assistant',
        content: `⚠️ 未检测到 **${llm.provider}** 的有效 API 密钥。\n\n请点击下方或顶栏的【前往设置】填写 API Key，或者在顶部下拉菜单中切换为其他已配置的模型（如本地 Ollama）。`,
        timestamp: nowTime(),
        model: llm.model,
      };
      upsertSession(activeSessionId, (msgs) => [...msgs, userMsg, warnMsg]);
      if (!textToSend) setInput('');
      setErrorMsg(`未配置 ${llm.provider} 的 API 密钥。请点击【前往设置 Key】填写，或切换模型。`);
      return;
    }

    const aiMsgId = `ai_${Date.now() + 1}`;
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: nowTime(),
      model: llm.model,
    };

    const { activeId, sessions: nextSessions } = upsertSession(activeSessionId, (msgs) => [...msgs, userMsg, aiMsg]);
    if (!textToSend) setInput('');
    setLoading(true);

    const targetSession = nextSessions.find((s) => s.id === activeId);
    const existingMsgs = targetSession?.messages.filter((m) => m.id !== aiMsgId) ?? [userMsg];
    const effectiveMsgs = enableContext ? existingMsgs : [userMsg];
    
    // 若处于特定预设模式，在后台静默附加指令
    const apiMessages = effectiveMsgs.map((m, idx) => {
      if (idx === effectiveMsgs.length - 1 && m.role === 'user' && dynamicPromptPrefix && !m.content.startsWith(dynamicPromptPrefix)) {
        return {
          role: m.role,
          content: `${dynamicPromptPrefix}${m.content}`,
        };
      }
      return {
        role: m.role,
        content: m.content,
      };
    });

    try {
      let replyText = '';
      try {
        setStreamingId(aiMsgId);
        abortRef.current = false;
        let pendingDelta = '';
        let pendingReasoning = '';
        let lastFlushTs = 0;
        const flushDelta = (force = false) => {
          const now = Date.now();
          if (!pendingDelta && !pendingReasoning) return;
          if (!force && now - lastFlushTs < 80) return;
          const chunk = pendingDelta;
          const reasoningChunk = pendingReasoning;
          pendingDelta = '';
          pendingReasoning = '';
          lastFlushTs = now;
          setSessions((prev) =>
            prev.map((s) =>
              s.id !== activeId
                ? s
                : {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === aiMsgId
                        ? {
                            ...m,
                            content: m.content + chunk,
                            reasoning: (m.reasoning || '') + reasoningChunk,
                          }
                        : m
                    ),
                  }
            )
          );
        };
        replyText = await cmdChatLlmStream(apiMessages, llm, (delta, reasoning) => {
          if (abortRef.current) return;
          if (delta) pendingDelta += delta;
          if (reasoning) pendingReasoning += reasoning;
          flushDelta();
        });
        flushDelta(true);
      } catch (streamErr) {
        if (abortRef.current) return;
        console.warn('Streaming failed, falling back to non-stream chat:', streamErr);
        replyText = await cmdChatLlm(apiMessages, llm);
      }
      if (abortRef.current) return;

      // 如果非流式或者包含 <think> 标签，拆分出思路文字
      let finalContent = replyText;
      let finalReasoning: string | undefined = undefined;
      if (replyText.includes('<think>') && replyText.includes('</think>')) {
        const parts = replyText.split('</think>');
        finalReasoning = parts[0].replace('<think>', '').trim();
        finalContent = parts.slice(1).join('</think>').trim();
      }

      // 以服务端完整文本兜底校准（防止个别丢包导致的内容缺失）
      setSessions((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeId) return s;
          const target = s.messages.find((m) => m.id === aiMsgId);
          if (target) {
            const nextContent = finalContent.trim() && target.content !== finalContent && target.content.length < finalContent.length
              ? finalContent
              : target.content;
            const nextReasoning = finalReasoning || target.reasoning;
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === aiMsgId
                  ? { ...m, content: nextContent, reasoning: nextReasoning }
                  : m
              ),
            };
          }
          return s;
        });
        if (initializedRef.current) persistSessions(next);
        return next;
      });
    } catch (err) {
      if (abortRef.current) return;
      console.error('AI Chat Error:', err);
      const rawErr = typeof err === 'string' ? err : (err as Error)?.message || String(err || '');
      let friendly = rawErr;
      if (rawErr.includes('Failed to fetch') || rawErr.includes('fetch failed')) {
        friendly = `无法连接到 ${llm.provider} 接口 (Failed to fetch)。请检查网络连接、API 密钥 (API Key) 或接口地址 (Base URL) 是否匹配。`;
      } else if (rawErr.includes('401') || rawErr.includes('Unauthorized')) {
        friendly = `API 密钥身份验证失败 (401 Unauthorized)。请重新核对填写的 ${llm.provider} API Key。`;
      } else if (rawErr.includes('429') || rawErr.includes('Rate limit')) {
        friendly = '请求过于频繁或 API 余额不足 (429 Rate Limit)。请稍后重试。';
      } else if (!rawErr) {
        friendly = 'AI 接口请求失败，请检查网络设置与接口配置。';
      }
      setErrorMsg(friendly);
      // 失败时将占位消息更新为错误说明，保留用户问题与可追溯性
      setSessions((prev) => {
        const next = prev.map((s) =>
          s.id !== activeId
            ? s
            : {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === aiMsgId ? { ...m, content: `⚠️ **请求失败**：${friendly}` } : m
                ),
              }
        );
        if (initializedRef.current) persistSessions(next);
        return next;
      });
    } finally {
      setStreamingId(null);
      setLoading(false);
    }
  };

  const handleRegenerate = async (aiMsgId: string) => {
    if (loading || !activeSession) return;
    const msgIndex = messages.findIndex((m) => m.id === aiMsgId);
    if (msgIndex < 0) return;
    const priorMessages = messages.slice(0, msgIndex);
    const lastUserMsg = [...priorMessages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;

    setSessions((prev) =>
      prev.map((s) =>
        s.id !== activeSessionId
          ? s
          : {
              ...s,
              messages: priorMessages,
            }
      )
    );

    await handleSend(lastUserMsg.content);
  };

  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
  };

  const handleNewSession = () => {
    setActiveSessionId(null);
    setErrorMsg(null);
    setActivePresetLabel(null);
    setInput('');
  };


  const handleClearChat = () => {
    if (activeSessionId) handleDeleteSession(activeSessionId);
    else setErrorMsg(null);
  };

  const applyPresetPrompt = (label: string) => {
    if (activePresetLabel === label) {
      setActivePresetLabel(null);
    } else {
      setActivePresetLabel(label);
      // 保持输入框干净清爽，若有历史残留长前缀则自动清除
      setInput((prev) => {
        let cleaned = prev;
        for (const p of PROMPT_PRESETS) {
          if (cleaned.startsWith(p.promptPrefix)) {
            cleaned = cleaned.slice(p.promptPrefix.length);
          }
        }
        return cleaned.trimStart();
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full gap-3 select-text">
      {/* 左侧会话栏（有历史会话时显示） */}
      {sessions.length > 0 && (
        <aside className="hidden md:flex w-[165px] shrink-0 flex-col gap-2">
          <button type="button" onClick={handleNewSession} className="lg-btn lg-btn-primary !text-xs !py-2 font-semibold">
            <SquarePen className="h-3.5 w-3.5" />
            新对话
          </button>
          <div className="lg-inset flex-1 overflow-y-auto scrollbar-thin p-1.5 space-y-0.5">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`group relative flex items-center rounded-[10px] px-2.5 py-2 cursor-pointer transition ${
                  s.id === activeSessionId ? '' : 'hover:bg-[var(--g-surface-2)]'
                }`}
                style={s.id === activeSessionId ? { background: 'var(--accent-soft)' } : undefined}
                onClick={() => {
                  setActiveSessionId(s.id);
                  setErrorMsg(null);
                }}
              >
                <MessageSquare
                  className="h-3.5 w-3.5 shrink-0 mr-2"
                  style={{ color: s.id === activeSessionId ? 'var(--accent-text)' : 'var(--g-text-3)' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate" title={s.title}>{s.title}</div>
                  <div className="text-[10px] tabular-nums mt-0.5" style={{ color: 'var(--g-text-3)' }}>
                    {sessionDisplayTime(s.updatedAt)} · {s.messages.length} 条
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition p-1 rounded-md hover:bg-[var(--g-surface-3)] cursor-pointer"
                  style={{ color: 'var(--danger)' }}
                  title="删除会话"
                  aria-label={`删除会话 ${s.title}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* 右侧主聊天区 */}
      <div className="flex flex-col flex-1 min-w-0 space-y-2.5 relative">
        {/* 历史会话侧边抽屉 */}
        {isHistoryOpen && (
          <div
            className="absolute inset-y-0 left-0 z-30 w-72 sm:w-80 rounded-2xl border border-[var(--g-border)] bg-[var(--g-surface)]/95 backdrop-blur-2xl shadow-2xl flex flex-col animate-in slide-in-from-left duration-200"
            style={{ borderColor: 'var(--g-border)' }}
          >
            <div className="flex items-center justify-between p-3.5 border-b border-[var(--g-border)]">
              <div className="flex items-center space-x-2">
                <History className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />
                <h3 className="text-xs font-bold">历史对话 ({sessions.length})</h3>
              </div>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="lg-btn !px-2 !py-1 !text-[11px] font-semibold"
                  title="开启新对话"
                >
                  <SquarePen className="h-3 w-3" />
                  <span>新建</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(false)}
                  className="lg-btn lg-btn-ghost !p-1"
                  title="关闭抽屉"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 会话列表 */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin">
              {sessions.length === 0 ? (
                <div className="p-8 text-center text-xs" style={{ color: 'var(--g-text-3)' }}>
                  暂无历史对话记录
                </div>
              ) : (
                sessions.map((sess) => {
                  const isActive = sess.id === activeSessionId;
                  const isEditing = editingSessionId === sess.id;
                  return (
                    <div
                      key={sess.id}
                      onClick={() => {
                        setActiveSessionId(sess.id);
                        setIsHistoryOpen(false);
                      }}
                      className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs transition border ${
                        isActive
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold shadow-xs'
                          : 'border-transparent hover:bg-[var(--g-surface-2)] text-[var(--g-text-2)]'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingSessionTitle}
                            onChange={(e) => setEditingSessionTitle(e.target.value)}
                            onBlur={() => handleSaveRenameSession(sess.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRenameSession(sess.id);
                              if (e.key === 'Escape') setEditingSessionId(null);
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            className="lg-input !py-0.5 !px-1.5 text-xs w-full"
                          />
                        ) : (
                          <div className="truncate font-medium">{sess.title}</div>
                        )}
                        <div className="text-[10px] mt-0.5 text-[var(--g-text-3)] flex items-center space-x-1.5">
                          <span>{sess.messages.length} 条对话</span>
                          <span>·</span>
                          <span>{sessionDisplayTime(sess.updatedAt)}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => handleStartRenameSession(sess, e)}
                          className="p-1 rounded hover:bg-[var(--g-surface-3)] text-[var(--g-text-3)] hover:text-[var(--g-text-1)]"
                          title="重命名会话"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(sess.id, e)}
                          className="p-1 rounded hover:bg-red-500/10 text-[var(--g-text-3)] hover:text-red-500"
                          title="删除此会话"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 顶部 Header：模型状态 + 快捷操作（紧凑流线排布） */}
        <div className="lg-panel px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-xs shrink-0"
              style={{ background: 'var(--accent)' }}
            >
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xs sm:text-sm font-bold">AI 智能对话</h2>
                {configuredLlmConfigs.length > 1 ? (
                  <GlassSelect
                    value={llm.id || `${llm.provider}-${llm.model}`}
                    onChange={(val) => {
                      const found = configuredLlmConfigs.find(
                        (c) => (c.id || `${c.provider}-${c.model}`) === val
                      );
                      if (found) {
                        setLlmConfig(found);
                        setErrorMsg(null);
                      }
                    }}
                    direction="down"
                    size="sm"
                    title="快速切换当前对话所使用的大模型"
                    options={configuredLlmConfigs.map((cfg) => {
                      const idVal = cfg.id || `${cfg.provider}-${cfg.model}`;
                      return {
                        value: idVal,
                        label: `${cfg.provider} (${cfg.model || '默认'})`,
                      };
                    })}
                  />
                ) : configuredLlmConfigs.length === 1 ? (
                  <span className="lg-pill font-semibold text-[11px] py-0.5 px-2">
                    {configuredLlmConfigs[0].provider} ({configuredLlmConfigs[0].model || '默认'})
                  </span>
                ) : (
                  <span className="lg-pill text-[11px] py-0.5 px-2">{llm.provider}</span>
                )}
              </div>
              <p className="text-[10px] font-mono flex items-center gap-1.5 flex-wrap leading-none mt-0.5" style={{ color: 'var(--g-text-3)' }}>
                <span>Model: <span className="font-semibold" style={{ color: 'var(--g-text-2)' }}>{llm.model || 'deepseek-chat'}</span></span>
                {!isModelConfigured(llm) && onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-amber-500 hover:underline cursor-pointer font-sans text-[10px] font-semibold flex items-center gap-0.5"
                  >
                    <span>⚠️ 未配置 Key</span>
                    <span>(前往设置)</span>
                  </button>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1 flex-wrap gap-y-1">
            <button
              type="button"
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className={`lg-btn !px-2 !py-1 !text-[11px] font-medium transition ${
                isHistoryOpen ? 'lg-btn-primary font-semibold' : ''
              }`}
              title="查看与管理历史对话记录"
            >
              <History className="h-3 w-3" />
              <span>历史 ({sessions.length})</span>
            </button>

            <button
              type="button"
              onClick={handleNewSession}
              className="lg-btn !px-2 !py-1 !text-[11px] font-semibold"
              title="开启新的对话会话"
            >
              <SquarePen className="h-3 w-3" />
              <span>新对话</span>
            </button>

            <button
              type="button"
              onClick={handleExportMarkdown}
              disabled={messages.length === 0}
              className="lg-btn !px-2 !py-1 !text-[11px] transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="将当前完整对话复制为 Markdown 格式"
            >
              <Download className="h-3 w-3" />
              <span>导出</span>
            </button>

            <button
              type="button"
              onClick={handleClearChat}
              className="lg-btn lg-btn-ghost !px-1.5 !py-1 !text-[11px]"
              title="清空当前聊天会话"
            >
              <Trash2 className="h-3 w-3" />
              <span>清空</span>
            </button>
          </div>
        </div>

        {/* 快捷 Prompt 模板 Pills 与上下文记忆开关（紧凑排布） */}
        <div className="flex items-center justify-between gap-1.5 overflow-x-auto scrollbar-none shrink-0 py-0.5">
          <div className="flex items-center space-x-1.5 shrink-0">
            {PROMPT_PRESETS.map((preset) => {
              const Icon = preset.icon;
              const isActive = activePresetLabel === preset.label;
              const selectedLang = AI_TRANSLATE_LANGUAGES.find((l) => l.code === translateTargetLang);
              const pillLabel = preset.id === 'ai_translate' && isActive && translateTargetLang !== 'auto'
                ? `AI 翻译 (${selectedLang?.shortName || translateTargetLang})`
                : preset.label;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPresetPrompt(preset.label)}
                  className={`lg-btn !px-2.5 !py-1 !text-[11px] !rounded-full shrink-0 whitespace-nowrap transition-all ${
                    isActive ? 'lg-btn-primary font-semibold shadow-xs' : ''
                  }`}
                  title={preset.id === 'ai_translate' ? '点击开启 AI 对话翻译模式，支持 30+ 语种自由互译' : undefined}
                >
                  <Icon className="h-3 w-3" />
                  <span>{pillLabel}</span>
                </button>
              );
            })}
          </div>

          {/* 连续上下文记忆开关 */}
          <button
            type="button"
            onClick={() => setEnableContext(!enableContext)}
            className={`lg-btn !px-2.5 !py-1 !text-[11px] !rounded-full shrink-0 flex items-center space-x-1 transition ${
              enableContext
                ? 'border-blue-500/50 bg-blue-500/10 text-blue-500 font-semibold'
                : 'opacity-70'
            }`}
            title={enableContext ? '已开启连续上下文记忆（提问时自动携带上文对话）' : '已关闭上下文记忆（单轮独立提问，更省 Token，速度更快）'}
          >
            <BrainCircuit className="h-3 w-3" />
            <span>{enableContext ? '连续对话' : '单轮问答'}</span>
          </button>
        </div>

        {/* 聊天消息流主视图 */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="lg-panel flex-1 min-h-0 p-3 sm:p-4 overflow-y-auto space-y-3 scrollbar-thin relative"
        >
          {/* Error Alert */}
          {errorMsg && (
            <div
              className="rounded-xl border p-3.5 text-xs flex flex-wrap items-center justify-between gap-2 shrink-0 animate-in fade-in"
              style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)', color: isLight ? '#b91c1c' : '#fecaca' }}
            >
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="leading-relaxed font-medium">{errorMsg}</span>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="lg-btn lg-btn-primary !px-3 !py-1 !text-[11px] font-semibold"
                  >
                    前往设置 Key
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="lg-btn !px-2.5 !py-1 !text-[11px]"
                >
                  关闭
                </button>
              </div>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[320px] h-full text-center space-y-4 py-8 px-4 select-none">
              <div className="lg-inset flex h-14 w-14 items-center justify-center !rounded-2xl">
                <Bot className="h-7 w-7" style={{ color: 'var(--accent-text)' }} />
              </div>

              <div className="space-y-1 max-w-md">
                <h3 className="text-sm font-bold">猫步 AI 智能对话助手就绪</h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--g-text-2)' }}>
                  当前准备调用 <span className="font-mono font-semibold" style={{ color: 'var(--accent-text)' }}>{llm.provider} ({llm.model || 'deepseek-chat'})</span> 大模型
                </p>
              </div>

              {/* Quick Starter Prompt Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl pt-2">
                {PROMPT_PRESETS.map((preset) => {
                  const Icon = preset.icon;
                  const isActive = activePresetLabel === preset.label;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPresetPrompt(preset.label)}
                      className={`lg-inset flex items-start space-x-3 p-3.5 text-left transition cursor-pointer group hover:bg-[var(--g-surface-2)] ${
                        isActive ? 'ring-2 ring-[var(--accent)]' : ''
                      }`}
                      style={isActive ? { background: 'var(--accent-soft)' } : undefined}
                    >
                      <div className="lg-pill !p-1.5 shrink-0 group-hover:scale-110 transition-transform">
                        <Icon className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold flex items-center justify-between">
                          <span>{preset.label}</span>
                          {isActive && <span className="text-[10px] font-semibold" style={{ color: 'var(--accent-text)' }}>(已开启)</span>}
                        </div>
                        <div className="text-[11px] line-clamp-1 mt-0.5" style={{ color: 'var(--g-text-3)' }}>
                          {preset.id === 'ai_translate'
                            ? '中英双向深度互译，保留专业术语'
                            : preset.id === 'polish'
                            ? '符合专业学术规范，保留术语'
                            : preset.id === 'cg_dict'
                            ? '3D/CG 节点与材质深度剖析'
                            : preset.id === 'code_comment'
                            ? '代码注释与变量名地道中译'
                            : '3 种风格多语境重写'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isStreaming = streamingId === msg.id;
              return (
                <div
                  key={msg.id}
                  className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
                >
                  {/* Avatar */}
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-md"
                    style={
                      isUser
                        ? { background: 'var(--accent)', color: '#fff' }
                        : { background: 'var(--g-surface-2)', border: '1px solid var(--g-border)', color: 'var(--accent-text)' }
                    }
                  >
                    {isUser ? 'ME' : 'AI'}
                  </div>

                  {/* Message Bubble */}
                  <div className={`space-y-1.5 max-w-[88%] ${isUser ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-center space-x-2 text-[11px] px-1 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`} style={{ color: 'var(--g-text-3)' }}>
                      <span className="font-medium">{isUser ? '我' : msg.model || llm.provider}</span>
                      {isUser && msg.mode && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                          {msg.mode}
                        </span>
                      )}
                      <span>·</span>
                      <span>{msg.timestamp}</span>
                    </div>

                    <div
                      className={`rounded-2xl px-5 py-3.5 text-[14.5px] leading-relaxed transition-all shadow-xs ${
                        isUser ? 'rounded-tr-xs' : 'lg-inset !rounded-2xl rounded-tl-xs'
                      }`}
                      style={
                        isUser
                          ? { background: 'var(--accent)', color: '#fff' }
                          : undefined
                      }
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap select-text">{msg.content}</p>
                      ) : (
                        <div className="space-y-3">
                          {/* 深度思考过程 / 思路文字折叠卡片：回复完默认闭合，限高紧凑不遮挡上下文 */}
                          {(msg.reasoning || (isStreaming && !msg.content)) && (() => {
                            const isCollapsed = msg.isReasoningCollapsed !== undefined
                              ? msg.isReasoningCollapsed
                              : (!isStreaming || !!msg.content);
                            return (
                              <div
                                className="rounded-xl border border-dashed overflow-hidden text-xs transition-all animate-in fade-in"
                                style={{
                                  background: isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)',
                                  borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--g-border))',
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleReasoningCollapse(msg.id)}
                                  className="w-full flex items-center justify-between px-3 py-1.5 text-left font-medium transition cursor-pointer select-none group hover:bg-[var(--g-surface-2)]"
                                  style={{ color: 'var(--g-text-2)' }}
                                >
                                  <div className="flex items-center space-x-2 min-w-0">
                                    <BrainCircuit
                                      className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                                        isStreaming && !msg.content ? 'animate-pulse' : 'opacity-70'
                                      }`}
                                      style={{ color: 'var(--accent-text)' }}
                                    />
                                    <span className="font-semibold text-xs flex items-center gap-1.5">
                                      <span>💭 思考过程</span>
                                      {isStreaming && !msg.content ? (
                                        <span className="text-[10.5px] font-normal font-mono" style={{ color: 'var(--accent-text)' }}>
                                          {waitingSeconds < 3
                                            ? '(正在构建思维链...)'
                                            : `(正在推导 ${waitingSeconds}s...)`}
                                        </span>
                                      ) : msg.reasoning ? (
                                        <span className="text-[10.5px] font-normal text-emerald-500 font-sans">
                                          · 思考完毕 {msg.reasoning.length > 0 ? `(${msg.reasoning.length} 字)` : ''}
                                        </span>
                                      ) : null}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-1.5 text-[11px]" style={{ color: 'var(--g-text-3)' }}>
                                    <span>{isCollapsed ? '展开思路' : '收起思路'}</span>
                                    <ChevronDown
                                      className={`h-3.5 w-3.5 transition-transform duration-200 ${
                                        isCollapsed ? '-rotate-90' : ''
                                      }`}
                                    />
                                  </div>
                                </button>

                                {!isCollapsed && (
                                  <div
                                    className="px-3 pb-2.5 pt-1 border-t border-[var(--g-border)]/30 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap select-text max-h-36 overflow-y-auto scrollbar-thin"
                                    style={{ color: isLight ? '#475569' : '#94a3b8' }}
                                  >
                                    {msg.reasoning ? (
                                      <>
                                        {msg.reasoning}
                                        {isStreaming && !msg.content && (
                                          <span
                                            className="inline-block w-1.5 h-3 ml-1 animate-pulse align-middle rounded-xs"
                                            style={{ background: 'var(--accent)' }}
                                          />
                                        )}
                                      </>
                                    ) : (
                                      <div className="space-y-1 py-1 text-[11px] font-sans" style={{ color: 'var(--g-text-3)' }}>
                                        <div className="flex items-center space-x-2">
                                          <span className="h-1.5 w-1.5 rounded-full animate-ping" style={{ background: 'var(--accent)' }} />
                                          <span className="font-medium">正在建立端到端流式通道，连接推理模型 ({llm.model || 'SenseNova'})...</span>
                                        </div>
                                        <div className="text-[10.5px] opacity-75 pl-3.5">
                                          已耗时 {waitingSeconds}s · 正在接收模型实时思维链，推理细节将逐字跳动上屏
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* 正式回答内容 */}
                          {msg.content ? (
                            <FormattedContent text={msg.content} isLight={isLight} streaming={isStreaming} />
                          ) : null}
                        </div>
                      )}
                    </div>

                    {/* Actions bar for AI messages */}
                    {!isUser && (
                      <div className="flex items-center space-x-3 pt-1 px-1 text-xs select-none">
                        {msg.content && (
                          <button
                            type="button"
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className="flex items-center space-x-1 transition cursor-pointer hover:opacity-80"
                            style={{ color: 'var(--g-text-3)' }}
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="h-3.5 w-3.5" style={{ color: 'var(--ok)' }} />
                                <span style={{ color: 'var(--ok)' }} className="font-semibold">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                <span>复制回答</span>
                              </>
                            )}
                          </button>
                        )}

                        {msg.reasoning && (
                          <button
                            type="button"
                            onClick={() => handleCopy(`${msg.id}_reasoning`, msg.reasoning!)}
                            className="flex items-center space-x-1 transition cursor-pointer hover:opacity-80"
                            style={{ color: 'var(--g-text-3)' }}
                          >
                            {copiedId === `${msg.id}_reasoning` ? (
                              <>
                                <Check className="h-3.5 w-3.5" style={{ color: 'var(--ok)' }} />
                                <span style={{ color: 'var(--ok)' }} className="font-semibold">思路已复制</span>
                              </>
                            ) : (
                              <>
                                <BrainCircuit className="h-3.5 w-3.5" />
                                <span>复制思路</span>
                              </>
                            )}
                          </button>
                        )}

                        {!isStreaming && (
                          <button
                            type="button"
                            onClick={() => handleRegenerate(msg.id)}
                            className="flex items-center space-x-1 transition cursor-pointer hover:opacity-80"
                            style={{ color: 'var(--g-text-3)' }}
                            title="重新生成此回答"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>重新生成</span>
                          </button>
                        )}

                        {!isStreaming && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="flex items-center space-x-1 transition cursor-pointer hover:text-red-500 opacity-60 hover:opacity-100"
                            style={{ color: 'var(--g-text-3)' }}
                            title="删除此条消息"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Actions bar for User messages */}
                    {isUser && (
                      <div className="flex items-center space-x-2.5 pt-0.5 px-1 text-xs select-none justify-end">
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="flex items-center space-x-1 transition cursor-pointer hover:opacity-80"
                          style={{ color: 'var(--g-text-3)' }}
                          title="复制提问"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="h-3 w-3" style={{ color: 'var(--ok)' }} />
                              <span style={{ color: 'var(--ok)' }}>已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>复制</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleEditUserMessage(msg.content)}
                          className="flex items-center space-x-1 transition cursor-pointer hover:opacity-80"
                          style={{ color: 'var(--g-text-3)' }}
                          title="填入输入框重新编辑"
                        >
                          <Pencil className="h-3 w-3" />
                          <span>编辑</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="flex items-center space-x-1 transition cursor-pointer hover:text-red-500 opacity-60 hover:opacity-100"
                          style={{ color: 'var(--g-text-3)' }}
                          title="删除此条提问"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* 悬浮滚到底部按钮 */}
          {showScrollBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="sticky bottom-3 float-right z-20 lg-pill !p-2.5 shadow-xl hover:scale-110 active:scale-95 transition-all cursor-pointer bg-[var(--g-surface)] border border-[var(--g-border)]"
              title="滚动到最新消息"
            >
              <ArrowDown className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />
            </button>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 底部 Input 表单发送区域（一体化现代自适应输入条，释放超过 100px 垂直视野） */}
        <div className="lg-panel p-2 sm:p-2.5 space-y-1.5 shrink-0 transition-all focus-within:border-[var(--accent)] shadow-xs">
          {activePresetLabel && (
            <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-medium rounded-lg border border-[var(--g-hairline)]" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
              <div className="flex items-center space-x-1.5 min-w-0 flex-wrap gap-y-0.5">
                <span className="flex items-center space-x-1 shrink-0">
                  <Sparkles className="h-3 w-3 shrink-0" />
                  <span>已激活 <strong>【{activePresetLabel}】</strong></span>
                </span>

                {activePresetLabel === 'AI 智能翻译' && (
                  <div className="flex items-center space-x-1 shrink-0">
                    <span className="text-[10px] opacity-80 ml-1">目标语言:</span>
                    <GlassSelect
                      value={translateTargetLang}
                      onChange={setTranslateTargetLang}
                      direction="up"
                      align="left"
                      size="sm"
                      searchable={true}
                      title="选择 AI 对话翻译的目标语言"
                      options={AI_TRANSLATE_LANGUAGES.map((l) => ({
                        value: l.code,
                        label: l.name,
                      }))}
                    />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  const currentPreset = PROMPT_PRESETS.find((p) => p.label === activePresetLabel);
                  if (currentPreset && input.startsWith(currentPreset.promptPrefix)) {
                    setInput(input.slice(currentPreset.promptPrefix.length));
                  }
                  setActivePresetLabel(null);
                }}
                className="text-[11px] cursor-pointer flex items-center space-x-0.5 hover:opacity-75 font-semibold shrink-0 ml-2"
                style={{ color: 'var(--accent-text)' }}
              >
                <X className="h-3 w-3" />
                <span>退出</span>
              </button>
            </div>
          )}

          <div className="relative flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                activePresetLabel === 'AI 智能翻译'
                  ? translateTargetLang === 'auto'
                    ? '【已开启 AI 智能翻译模式 · 中英双向】输入任意文本即可进行 AI 深度翻译 (Enter 发送)...'
                    : `【已开启 AI 智能翻译模式 · 译为 ${AI_TRANSLATE_LANGUAGES.find((l) => l.code === translateTargetLang)?.shortName || translateTargetLang}】输入任意文本即可进行 AI 深度翻译 (Enter 发送)...`
                  : activePresetLabel
                  ? `【已激活 ${activePresetLabel}】输入内容直接发送 (Enter 发送，Shift+Enter 换行)...`
                  : '输入翻译需求、多语种润色或任意问题 (Enter 发送，Shift+Enter 换行)...'
              }
              rows={1}
              className="w-full bg-transparent border-0 focus:outline-none focus:ring-0 px-2 py-1 text-xs sm:text-[13px] leading-relaxed resize-none scrollbar-thin max-h-[120px] min-h-[36px]"
              style={{ color: 'var(--g-text)' }}
            />

            <div className="flex items-center gap-1.5 shrink-0 pb-0.5 pr-0.5 select-none">
              {input.length > 0 && (
                <span className="text-[10px] font-mono opacity-50 hidden sm:inline-block" style={{ color: 'var(--g-text-3)' }}>
                  {input.length} 字
                </span>
              )}

              {loading ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="flex h-7.5 px-2.5 items-center justify-center space-x-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white shadow-xs transition active:scale-95 cursor-pointer"
                  title="中断并停止当前回答生成"
                >
                  <Square className="h-3 w-3 fill-current" />
                  <span className="text-xs font-semibold">停止</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className={`flex h-7.5 px-3 items-center justify-center space-x-1 rounded-lg transition-all cursor-pointer ${
                    input.trim()
                      ? 'bg-[var(--accent)] text-white shadow-xs hover:opacity-90 active:scale-95'
                      : 'opacity-30 cursor-not-allowed bg-[var(--g-surface-3)] text-[var(--g-text-3)]'
                  }`}
                  title="发送 (Enter 发送，Shift+Enter 换行)"
                >
                  <Send className="h-3 w-3" />
                  <span className="text-xs font-semibold">发送</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
