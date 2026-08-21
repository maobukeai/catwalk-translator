import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Bot,
  Send,
  Trash2,
  Copy,
  Check,
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
import type { ChatMessage, LlmConfig } from '../../services/types';
import { cmdChatLlm, cmdChatLlmStream } from '../../services/tauri';

interface AiChatPanelProps {
  initialPrompt?: string;
  onOpenSettings?: () => void;
}

const PROMPT_PRESETS = [
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
    <div className="space-y-1 select-text">
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
          <div key={idx} className={trimmed === '' ? 'h-2' : 'min-h-[1.25rem]'}>
            {lineNodes}
          </div>
        );
      })}
    </div>
  );
  return streaming ? <span className="stream-caret">{nodes}</span> : nodes;
}

export const AiChatPanel: React.FC<AiChatPanelProps> = ({ initialPrompt = '', onOpenSettings }) => {
  const { settings } = useSettingsStore();
  const { isLight } = useAppTheme();

  const llm = settings.llmConfig || {
    provider: 'DeepSeek',
    apiKey: '',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1',
  };

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState(initialPrompt);
  const [activePresetLabel, setActivePresetLabel] = useState<string | null>(null);
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

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const messages = activeSession?.messages ?? [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    if (sessionId) {
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
      nextSessions = [newSession, ...sessions];
      activeId = newSession.id;
    }
    nextSessions = nextSessions.slice(0, MAX_SESSIONS);
    setSessions(nextSessions);
    setActiveSessionId(activeId);
    if (initializedRef.current) persistSessions(nextSessions);
    return { sessions: nextSessions, activeId };
  }, [sessions]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    setErrorMsg(null);

    // Pre-flight check for missing API Key
    const isLocalEndpoint = llm.endpoint.includes('localhost') || llm.endpoint.includes('127.0.0.1');
    if (!llm.apiKey && !isLocalEndpoint) {
      setErrorMsg(`未配置 ${llm.provider} 的 API 密钥。请点击【前往设置】填写，或使用本地 Ollama / 公共翻译通道。`);
      return;
    }

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: nowTime(),
    };

    const { activeId } = upsertSession(activeSessionId, (msgs) => [...msgs, userMsg]);
    if (!textToSend) setInput('');
    setActivePresetLabel(null);
    setLoading(true);

    const aiMsgId = `ai_${Date.now()}`;
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: nowTime(),
      model: llm.model,
    };
    upsertSession(activeId, (msgs) => [...msgs, aiMsg]);

    const apiMessages = [...(sessions.find((s) => s.id === activeId)?.messages ?? []), userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

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
      // 失败时移除空的占位消息
      setSessions((prev) =>
        prev.map((s) =>
          s.id !== activeId ? s : { ...s, messages: s.messages.filter((m) => m.id !== aiMsgId) }
        )
      );
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

  const applyPresetPrompt = (label: string, promptPrefix: string) => {
    setActivePresetLabel(label);
    setInput((prev) => {
      if (prev.startsWith(promptPrefix)) return prev;
      return `${promptPrefix}${prev}`;
    });
  };

  return (
    <div className="flex h-full min-h-0 max-w-4xl mx-auto gap-3 select-text">
      {/* 左侧会话栏（有历史会话时显示） */}
      {sessions.length > 0 && (
        <aside className="hidden md:flex w-[164px] shrink-0 flex-col gap-2">
          <button type="button" onClick={handleNewSession} className="lg-btn lg-btn-primary !text-[11.5px] !py-2">
            <SquarePen className="h-3.5 w-3.5" />
            新对话
          </button>
          <div className="lg-inset flex-1 overflow-y-auto scrollbar-thin p-1.5 space-y-0.5">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`group relative flex items-center rounded-[10px] px-2 py-1.5 cursor-pointer transition ${
                  s.id === activeSessionId ? '' : 'hover:bg-[var(--g-surface-2)]'
                }`}
                style={s.id === activeSessionId ? { background: 'var(--accent-soft)' } : undefined}
                onClick={() => {
                  setActiveSessionId(s.id);
                  setErrorMsg(null);
                }}
              >
                <MessageSquare
                  className="h-3.5 w-3.5 shrink-0 mr-1.5"
                  style={{ color: s.id === activeSessionId ? 'var(--accent-text)' : 'var(--g-text-3)' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold truncate" title={s.title}>{s.title}</div>
                  <div className="text-[9.5px] tabular-nums" style={{ color: 'var(--g-text-3)' }}>
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
      <div className="flex flex-col flex-1 min-w-0 space-y-3">
        {/* 顶部 Header：模型状态 + 快捷操作 */}
        <div className="lg-panel p-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
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
                <span className="lg-pill">{llm.provider}</span>
              </div>
              <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--g-text-3)' }}>
                Model: <span className="font-semibold" style={{ color: 'var(--g-text-2)' }}>{llm.model || 'deepseek-chat'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleNewSession}
              className="lg-btn !px-2.5 !py-1.5 !text-[11px]"
              title="开启新的对话会话"
            >
              <SquarePen className="h-3.5 w-3.5" />
              新对话
            </button>
            <button
              type="button"
              onClick={handleClearChat}
              className="lg-btn lg-btn-ghost !px-2.5 !py-1.5 !text-[11px]"
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
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPresetPrompt(preset.label, preset.promptPrefix)}
                className={`lg-btn !px-3 !py-1.5 !text-[11.5px] !rounded-full shrink-0 whitespace-nowrap ${
                  isActive ? 'lg-btn-primary' : ''
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>

        {/* 聊天消息流主视图 */}
        <div className="lg-panel flex-1 min-h-0 p-4 overflow-y-auto space-y-4 scrollbar-thin">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-8 px-4 select-none">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg pt-2">
                {PROMPT_PRESETS.map((preset) => {
                  const Icon = preset.icon;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPresetPrompt(preset.label, preset.promptPrefix)}
                      className="lg-inset flex items-start space-x-2.5 p-3 text-left transition cursor-pointer group hover:bg-[var(--g-surface-2)]"
                    >
                      <div className="lg-pill !p-1.5 shrink-0 group-hover:scale-110 transition-transform">
                        <Icon className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />
                      </div>
                      <div>
                        <div className="text-xs font-bold">{preset.label}</div>
                        <div className="text-[10px] line-clamp-1 mt-0.5" style={{ color: 'var(--g-text-3)' }}>{preset.promptPrefix.trim()}</div>
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold shadow-md"
                    style={
                      isUser
                        ? { background: 'var(--accent)', color: '#fff' }
                        : { background: 'var(--g-surface-2)', border: '1px solid var(--g-border)', color: 'var(--accent-text)' }
                    }
                  >
                    {isUser ? 'ME' : 'AI'}
                  </div>

                  {/* Message Bubble */}
                  <div className={`space-y-1 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-center space-x-2 text-[10px] px-1`} style={{ color: 'var(--g-text-3)' }}>
                      <span>{isUser ? '我' : msg.model || llm.provider}</span>
                      <span>·</span>
                      <span>{msg.timestamp}</span>
                    </div>

                    <div
                      className={`rounded-2xl p-3.5 text-xs leading-relaxed transition-all ${
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
                      <div className={`flex items-center space-x-2 pt-1 px-1 text-[11px]`}>
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="flex items-center space-x-1 transition cursor-pointer hover:opacity-80"
                          style={{ color: 'var(--g-text-3)' }}
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="h-3 w-3" style={{ color: 'var(--ok)' }} />
                              <span style={{ color: 'var(--ok)' }} className="font-semibold">已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
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

          {/* Error Alert */}
          {errorMsg && (
            <div
              className="rounded-xl border p-3.5 text-xs flex flex-wrap items-center justify-between gap-2"
              style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)', color: isLight ? '#b91c1c' : '#fecaca' }}
            >
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="leading-relaxed">{errorMsg}</span>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                {onOpenSettings && (!llm.apiKey && !llm.endpoint.includes('localhost')) && (
                  <button type="button" onClick={onOpenSettings} className="lg-btn lg-btn-primary !px-3 !py-1 !text-[11px]">
                    前往设置 Key
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSend()}
                  className="lg-btn !px-2.5 !py-1 !text-[11px]"
                >
                  重试
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 底部 Input 表单发送区域 */}
        <div className="lg-panel p-3.5 space-y-2.5 shrink-0">
          {activePresetLabel && (
            <div className="flex items-center justify-between px-1 text-xs font-medium border-b pb-1.5" style={{ borderColor: 'var(--g-hairline)', color: 'var(--accent-text)' }}>
              <span className="flex items-center space-x-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                <span>已激活模式: <strong>{activePresetLabel}</strong></span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setActivePresetLabel(null);
                  setInput('');
                }}
                className="text-[11px] cursor-pointer flex items-center space-x-1 hover:opacity-75"
                style={{ color: 'var(--g-text-3)' }}
              >
                <X className="h-3 w-3" />
                <span>清除模式</span>
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
              placeholder="输入翻译需求、多语种润色或任意问题 (Enter 发送，Shift+Enter 换行)..."
              rows={3}
              className="lg-input w-full p-3 text-xs resize-none scrollbar-thin"
            />

            <div className="flex items-center justify-between pt-0.5">
              <div className="text-[11px] flex items-center space-x-2 font-mono" style={{ color: 'var(--g-text-3)' }}>
                <span>{input.length} 字符</span>
                <span>·</span>
                <span>Enter 发送 / Shift+Enter 换行</span>
              </div>

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                className="lg-btn lg-btn-primary !px-5 !py-2 shrink-0"
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
