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
 * 格式化简单 Markdown（将 **bold** 渲染为高亮节点，将 - 渲染为列表项）
 */
function renderFormattedContent(text: string, isLight: boolean, streaming: boolean) {
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
}

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

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
    
    // 若处于特定预设模式，在后台静默附加指令
    const apiMessages = existingMsgs.map((m, idx) => {
      if (idx === existingMsgs.length - 1 && m.role === 'user' && dynamicPromptPrefix && !m.content.startsWith(dynamicPromptPrefix)) {
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
      let replyText: string;
      try {
        // 首选：流式增量输出
        setStreamingId(aiMsgId);
        replyText = await cmdChatLlmStream(apiMessages, llm, (delta) => {
          setSessions((prev) =>
            prev.map((s) =>
              s.id !== activeId
                ? s
                : {
                    ...s,
                    messages: s.messages.map((m) => (m.id === aiMsgId ? { ...m, content: m.content + delta } : m)),
                  }
            )
          );
        });
      } catch (streamErr) {
        // 回退：非流式一次性返回（旧后端 / 流式解析失败）
        console.warn('Streaming failed, falling back to non-stream chat:', streamErr);
        replyText = await cmdChatLlm(apiMessages, llm);
      }

      // 以服务端完整文本兜底校准（防止个别丢包导致的内容缺失）
      setSessions((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeId) return s;
          const target = s.messages.find((m) => m.id === aiMsgId);
          if (target && replyText.trim() && target.content !== replyText && target.content.length < replyText.length) {
            return { ...s, messages: s.messages.map((m) => (m.id === aiMsgId ? { ...m, content: replyText } : m)) };
          }
          return s;
        });
        if (initializedRef.current) persistSessions(next);
        return next;
      });
    } catch (err) {
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

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleNewSession = () => {
    setActiveSessionId(null);
    setErrorMsg(null);
    setActivePresetLabel(null);
    setInput('');
  };

  const handleDeleteSession = (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (initializedRef.current) persistSessions(next);
      return next;
    });
    if (activeSessionId === id) setActiveSessionId(null);
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
      <div className="flex flex-col flex-1 min-w-0 space-y-2.5">
        {/* 顶部 Header：模型状态 + 快捷操作 */}
        <div className="lg-panel p-3 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center space-x-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-md"
              style={{ background: 'var(--accent)', boxShadow: '0 3px 12px color-mix(in srgb, var(--accent) 30%, transparent)' }}
            >
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold">AI 智能对话</h2>
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
                  <span className="lg-pill font-semibold">
                    {configuredLlmConfigs[0].provider} ({configuredLlmConfigs[0].model || '默认'})
                  </span>
                ) : (
                  <span className="lg-pill">{llm.provider}</span>
                )}
              </div>
              <p className="text-[11px] font-mono mt-0.5 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--g-text-3)' }}>
                <span>Model: <span className="font-semibold" style={{ color: 'var(--g-text-2)' }}>{llm.model || 'deepseek-chat'}</span></span>
                {!isModelConfigured(llm) && onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-amber-500 hover:underline cursor-pointer font-sans text-[10.5px] font-semibold flex items-center gap-0.5"
                  >
                    <span>⚠️ 未配置 Key</span>
                    <span>(前往设置)</span>
                  </button>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleNewSession}
              className="lg-btn !px-3 !py-1.5 !text-xs font-semibold"
              title="开启新的对话会话"
            >
              <SquarePen className="h-3.5 w-3.5" />
              新对话
            </button>
            <button
              type="button"
              onClick={handleClearChat}
              className="lg-btn lg-btn-ghost !px-3 !py-1.5 !text-xs"
              title="清空当前聊天会话"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>清空</span>
            </button>
          </div>
        </div>

        {/* 快捷 Prompt 模板 Pills */}
        <div className="flex items-center space-x-2 overflow-x-auto scrollbar-none shrink-0 py-0.5">
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
                className={`lg-btn !px-3.5 !py-1.5 !text-xs !rounded-full shrink-0 whitespace-nowrap transition-all ${
                  isActive ? 'lg-btn-primary font-semibold shadow-sm' : ''
                }`}
                title={preset.id === 'ai_translate' ? '点击开启 AI 对话翻译模式，支持 30+ 语种自由互译' : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{pillLabel}</span>
              </button>
            );
          })}
        </div>

        {/* 聊天消息流主视图 */}
        <div className="lg-panel flex-1 min-h-0 p-4 sm:p-5 overflow-y-auto space-y-4 scrollbar-thin">
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
                      ) : msg.content ? (
                        renderFormattedContent(msg.content, isLight, isStreaming)
                      ) : (
                        <span className="inline-flex items-center space-x-2">
                          <span className="h-2 w-2 rounded-full animate-ping" style={{ background: 'var(--accent)' }} />
                          <span style={{ color: 'var(--g-text-3)' }}>AI 思考中…</span>
                        </span>
                      )}
                    </div>

                    {/* Actions bar for AI messages */}
                    {!isUser && !isStreaming && msg.content && (
                      <div className={`flex items-center space-x-2 pt-1 px-1 text-xs`}>
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
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 底部 Input 表单发送区域 */}
        <div className="lg-panel p-3.5 space-y-2.5 shrink-0">
          {activePresetLabel && (
            <div className="flex items-center justify-between px-3 py-1.5 text-xs font-medium rounded-xl border border-[var(--g-hairline)]" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
              <div className="flex items-center space-x-2 min-w-0 flex-wrap gap-y-1">
                <span className="flex items-center space-x-1.5 shrink-0">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  <span>已开启 <strong>【{activePresetLabel}】</strong> 模式</span>
                </span>

                {activePresetLabel === 'AI 智能翻译' && (
                  <div className="flex items-center space-x-1.5 shrink-0">
                    <span className="text-[11px] opacity-80 ml-1">目标语言:</span>
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
                className="text-xs cursor-pointer flex items-center space-x-1 hover:opacity-75 font-semibold shrink-0 ml-2"
                style={{ color: 'var(--accent-text)' }}
              >
                <X className="h-3.5 w-3.5" />
                <span>退出模式</span>
              </button>
            </div>
          )}

          <div className="flex flex-col space-y-2">
            <textarea
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
              rows={3}
              className="lg-input w-full p-3 text-[14px] leading-relaxed resize-none scrollbar-thin min-h-[78px]"
            />

            <div className="flex items-center justify-between pt-0.5">
              <div className="text-xs flex items-center space-x-2 font-mono" style={{ color: 'var(--g-text-3)' }}>
                <span>{input.length} 字符</span>
                <span>·</span>
                <span>Enter 发送 / Shift+Enter 换行</span>
              </div>

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                className="lg-btn lg-btn-primary !px-6 !py-2 !text-xs font-bold shrink-0 shadow-md shadow-blue-500/20"
              >
                <Send className="h-3.5 w-3.5" />
                <span>发送</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
