import React, { useState, useRef, useEffect } from 'react';
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
} from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import type { ChatMessage, LlmConfig } from '../../services/types';
import { cmdChatLlm } from '../../services/tauri';

interface AiChatPanelProps {
  initialPrompt?: string;
  onOpenSettings?: () => void;
}

const PROMPT_PRESETS = [
  {
    id: 'polish',
    label: '✍️ 学术润色',
    promptPrefix: '请将以下文本润色为符合专业学术规范的表达，保留原本专业术语：\n',
    icon: Sparkles,
  },
  {
    id: 'cg_dict',
    label: '🧊 CG 术语详解',
    promptPrefix: '请以 3D/CG 资深专家的视角，详细解释以下 3D/CG 节点或材质属性：\n',
    icon: BookOpen,
  },
  {
    id: 'code_comment',
    label: '💻 代码注释翻译',
    promptPrefix: '请将以下代码中的英文注释与变量命名翻译为准确地道的中文：\n',
    icon: Code,
  },
  {
    id: 'rewrite',
    label: '📝 多语境重写',
    promptPrefix: '请对以下句子提供 3 种不同风格（正式、日常口语、精简专业）的翻译重写：\n',
    icon: FileText,
  },
] as const;

async function sendLlmChat(
  messages: { role: string; content: string }[],
  config: LlmConfig
): Promise<string> {
  return await cmdChatLlm(messages, config);
}

/**
 * 格式化简单 Markdown（将 **bold** 渲染为高亮节点，将 - 渲染为精致列表项）
 */
function renderFormattedContent(text: string) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1 select-text">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
        const contentStr = isBullet ? trimmed.substring(2) : line;

        // 匹配 **bold** 标记
        const parts = contentStr.split(/(\*\*.*?\*\*)/g);
        const lineNodes = parts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
            return (
              <span
                key={pIdx}
                className="font-bold text-sky-300 bg-sky-500/15 border border-sky-400/30 px-1.5 py-0.5 rounded font-mono mx-0.5"
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
              <span className="text-blue-400 font-bold shrink-0 mt-0.5 text-xs">•</span>
              <span className="flex-1 text-zinc-200">{lineNodes}</span>
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
}

export const AiChatPanel: React.FC<AiChatPanelProps> = ({ initialPrompt = '', onOpenSettings }) => {
  const { settings } = useSettingsStore();
  const activeTheme = settings.appearance?.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  const llm = settings.llmConfig || {
    provider: 'DeepSeek',
    apiKey: '',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1',
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [input, setInput] = useState(initialPrompt);
  const [activePresetLabel, setActivePresetLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    setErrorMsg(null);

    // Pre-flight check for missing API Key
    const isLocalEndpoint = llm.endpoint.includes('localhost') || llm.endpoint.includes('127.0.0.1');
    if (!llm.apiKey && !isLocalEndpoint) {
      setErrorMsg(`⚠️ 未配置 ${llm.provider} 的 API 密钥。请点击【配置 API Key】进入设置填写，或使用本地 Ollama / 公共翻译通道。`);
      return;
    }

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    if (!textToSend) setInput('');
    setActivePresetLabel(null);
    setLoading(true);

    try {
      const apiMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const replyText = await sendLlmChat(apiMessages, llm);

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: llm.model,
      };

      setMessages((prev) => [...prev, aiMsg]);
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
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearChat = () => {
    setMessages([]);
    setErrorMsg(null);
  };

  const applyPresetPrompt = (label: string, promptPrefix: string) => {
    setActivePresetLabel(label);
    setInput((prev) => {
      if (prev.startsWith(promptPrefix)) return prev;
      return `${promptPrefix}${prev}`;
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4.5rem)] max-w-4xl mx-auto space-y-3 select-text font-sans">
      {/* 顶部 Header：模型状态 + 快捷操作 */}
      <div className={`p-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 shrink-0 border transition-all ${
        isLight
          ? 'bg-white/90 border-slate-200 shadow-sm text-slate-800'
          : 'bg-white/[0.05] border-white/15 shadow-lg text-zinc-100 backdrop-blur-xl'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-blue-600 to-sky-500 text-white shadow-md shadow-blue-500/20">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>AI 智能对话助手</h2>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/20 border-blue-400/40 text-sky-300'
              }`}>
                {llm.provider}
              </span>
            </div>
            <p className={`text-[11px] font-mono mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
              Model: <span className={`font-semibold ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>{llm.model || 'deepseek-chat'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleClearChat}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
              isLight
                ? 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
                : 'bg-white/10 border-white/15 text-zinc-200 hover:bg-white/20 hover:text-white'
            }`}
            title="清空当前聊天会话"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>清空对话</span>
          </button>
        </div>
      </div>

      {/* 快捷 Prompt 模板词 Pills */}
      <div className="flex items-center space-x-2 overflow-x-auto scrollbar-none shrink-0 py-0.5">
        {PROMPT_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const isActive = activePresetLabel === preset.label;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPresetPrompt(preset.label, preset.promptPrefix)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer shrink-0 whitespace-nowrap ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-400 shadow-md ring-2 ring-blue-500/30'
                  : (isLight
                      ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700 shadow-xs'
                      : 'bg-white/10 hover:bg-white/20 border-white/15 text-zinc-200 hover:text-white')
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-white' : 'text-blue-500'}`} />
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>

      {/* 聊天消息流主视图 */}
      <div className={`flex-1 min-h-0 p-4 overflow-y-auto space-y-4 scrollbar-thin border rounded-2xl shadow-inner ${
        isLight
          ? 'bg-white/80 border-slate-200 text-slate-800'
          : 'bg-white/[0.04] border-white/10 text-zinc-100 backdrop-blur-xl'
      }`}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-8 px-4 select-none">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 via-blue-600/20 to-sky-500/20 border border-blue-400/30 shadow-lg shadow-blue-500/10">
              <Bot className="h-7 w-7 text-blue-500" />
            </div>

            <div className="space-y-1 max-w-md">
              <h3 className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>猫步 AI 智能对话助手就绪</h3>
              <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                当前准备调用 <span className="text-blue-600 font-mono font-semibold">{llm.provider} ({llm.model || 'deepseek-chat'})</span> 大模型
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
                    className={`flex items-start space-x-2.5 p-3 rounded-xl border text-left transition cursor-pointer group ${
                      isLight
                        ? 'bg-white hover:bg-slate-50 border-slate-200 hover:border-blue-400/60 shadow-xs'
                        : 'bg-white/[0.04] hover:bg-white/[0.09] border-white/10 hover:border-blue-400/40'
                    }`}
                  >
                    <div className="p-1.5 rounded-lg bg-blue-500/15 border border-blue-400/30 text-blue-500 shrink-0 group-hover:scale-110 transition-transform">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className={`text-xs font-bold ${isLight ? 'text-slate-800 group-hover:text-blue-600' : 'text-zinc-200 group-hover:text-white'}`}>{preset.label}</div>
                      <div className={`text-[10px] line-clamp-1 mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>{preset.promptPrefix.trim()}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
              >
                {/* Avatar */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold shadow-md ${
                    isUser
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white'
                      : (isLight ? 'bg-slate-200 border border-slate-300 text-blue-700' : 'bg-zinc-800 border border-white/20 text-sky-400')
                  }`}
                >
                  {isUser ? 'ME' : 'AI'}
                </div>

                {/* Message Bubble */}
                <div className={`space-y-1 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                  <div className={`flex items-center space-x-2 text-[10px] px-1 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                    <span>{isUser ? '我' : msg.model || llm.provider}</span>
                    <span>·</span>
                    <span>{msg.timestamp}</span>
                  </div>

                  <div
                    className={`rounded-2xl p-4 text-xs leading-relaxed transition-all shadow-md ${
                      isUser
                        ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 text-white font-medium rounded-tr-xs'
                        : (isLight ? 'bg-white border border-slate-200 text-slate-900 rounded-tl-xs shadow-slate-200/50' : 'bg-zinc-950/85 border border-white/15 text-zinc-100 rounded-tl-xs backdrop-blur-md')
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap select-text">{msg.content}</p>
                    ) : (
                      renderFormattedContent(msg.content)
                    )}
                  </div>

                  {/* Actions bar for AI messages */}
                  {!isUser && (
                    <div className={`flex items-center space-x-2 pt-1 px-1 text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className={`flex items-center space-x-1 transition cursor-pointer ${isLight ? 'hover:text-slate-800' : 'hover:text-white'}`}
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-500" />
                            <span className="text-emerald-500 font-semibold">已复制</span>
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

        {/* Loading Indicator */}
        {loading && (
          <div className="flex items-start space-x-3">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs shadow-md ${
              isLight ? 'bg-slate-200 border border-slate-300 text-blue-700' : 'bg-zinc-800 border border-white/20 text-sky-400'
            }`}>
              <Bot className="h-4 w-4 animate-spin" />
            </div>
            <div className={`rounded-2xl rounded-tl-xs p-3.5 text-xs flex items-center space-x-2 shadow-md ${
              isLight ? 'bg-white border border-slate-200 text-blue-700' : 'bg-zinc-950/85 border border-white/15 text-sky-300 backdrop-blur-md'
            }`}>
              <div className="h-2 w-2 rounded-full bg-blue-500 animate-ping" />
              <span>AI 思考中，正在生成回答...</span>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className={`rounded-xl border p-3.5 text-xs flex flex-wrap items-center justify-between gap-2 shadow-md ${
            isLight ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-rose-500/15 border-rose-500/40 text-rose-200'
          }`}>
            <div className="flex items-center space-x-2 min-w-0 flex-1">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              {onOpenSettings && (!llm.apiKey && !llm.endpoint.includes('localhost')) && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold border border-blue-400/40 text-[11px] transition cursor-pointer shadow-sm"
                >
                  ⚙️ 前往设置 Key
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSend()}
                className="px-2.5 py-1 rounded-lg bg-rose-500/25 hover:bg-rose-500/40 text-rose-800 border border-rose-400/40 text-[11px] font-medium transition cursor-pointer"
              >
                重试
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 底部 Input 表单发送区域 */}
      <div className={`p-3.5 rounded-2xl space-y-2.5 shrink-0 border transition-all ${
        isLight ? 'bg-white/90 border-slate-200 shadow-md text-slate-800' : 'bg-white/[0.05] border-white/15 shadow-xl text-zinc-100 backdrop-blur-xl'
      }`}>
        {activePresetLabel && (
          <div className={`flex items-center justify-between px-1 text-xs font-medium border-b pb-1.5 ${
            isLight ? 'text-blue-700 border-slate-200' : 'text-sky-300 border-white/10'
          }`}>
            <span className="flex items-center space-x-1.5">
              <Sparkles className="h-3.5 w-3.5 text-blue-500" />
              <span>已激活模式: <strong>{activePresetLabel}</strong></span>
            </span>
            <button
              type="button"
              onClick={() => {
                setActivePresetLabel(null);
                setInput('');
              }}
              className={`text-[11px] cursor-pointer flex items-center space-x-1 ${
                isLight ? 'text-slate-500 hover:text-slate-800' : 'text-zinc-400 hover:text-zinc-200'
              }`}
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
            className={`w-full rounded-xl p-3 text-xs focus:border-blue-500 focus:outline-none resize-none scrollbar-thin shadow-inner border ${
              isLight
                ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
                : 'bg-zinc-950/80 border-white/15 text-zinc-100 placeholder-zinc-500'
            }`}
          />

          <div className="flex items-center justify-between pt-0.5">
            <div className={`text-[11px] flex items-center space-x-2 font-mono ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
              <span>{input.length} 字符</span>
              <span>·</span>
              <span>Enter 发送 / Shift+Enter 换行</span>
            </div>

            <button
              type="button"
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="flex items-center space-x-1.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 px-5 py-2 text-xs font-semibold text-white shadow-md disabled:opacity-40 transition-all cursor-pointer border border-blue-400/40 shrink-0 active:scale-95"
            >
              <Send className="h-3.5 w-3.5" />
              <span>发送消息</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
