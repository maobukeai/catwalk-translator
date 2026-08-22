import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle, ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Save, CheckCircle2,
  Camera, Zap, Bot, BookOpen, Sliders, Sparkles, ShieldCheck, Globe, Palette,
  Sun, Moon, Monitor, Plus, Trash2, Edit3, Search, Download, Upload, X,
  FileSpreadsheet, Copy, Check, Type, Languages, Tag, FileText, WifiOff,
  HardDriveDownload, CloudUpload,
} from 'lucide-react';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import {
  cmdGetOcrEngineStatus, cmdFetchLlmModels, cmdOfflineStatus, cmdOfflineInstall,
  cmdOfflineUninstall, cmdGetAutoStart, cmdSetAutoStart,
} from '../../../services/tauri';
import { normalizeHotkeyForCompare } from '../../../services/hotkeys';
import type { OfflineEngineStatus } from '../../../services/tauri';
import type {
  LlmConfig, OcrEngineStatus, ThemeMode, FontFamilyOption, FontSizeOption, CustomDictItem,
} from '../../../services/types';

const isTestEnv = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
const OCR_STATUS_STYLE: Record<string, string> = {
  idle: 'text-zinc-300 bg-zinc-500/15 border-zinc-400/30',
  warming: 'text-amber-300 bg-amber-500/15 border-amber-400/30 animate-pulse',
  ready: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30',
  failed: 'text-rose-300 bg-rose-500/15 border-rose-400/30',
  unknown: 'text-zinc-400 bg-zinc-500/15 border-zinc-400/20',
};
import { APP_VERSION } from '../../../version';

interface PreferencePanelProps {
  onOpenAbout?: () => void;
}

/** 优先级与系统偏好：翻译引擎优先级、OCR 引擎、监控行为、关闭行为、开机自启、置顶/代理/TTS */
export const PreferencePanel: React.FC<PreferencePanelProps> = ({ onOpenAbout }) => {
  const { isLight } = useAppTheme();
  const {
    settings,
    moveTier,
    setDefaultPreset,
    setCaptureEngine,
    setPrimaryTranslationEngine,
    setOcrEngine,
    setOcrFilterEnabled,
    setOcrFilterRules,
    setCaptureReleaseAction,
    setWatchIntervalMs,
    setClipboardWatchEnabled,
    setCloseAction,
    setMiniWindowCloseAction,
    setAlwaysOnTop,
    setProxyEnabled,
    setProxyUrl,
    setTtsRate,
  } = useSettingsStore();

  const appearance = settings.appearance || {
    theme: 'system',
    enableBlur: true,
    blurAmount: 24,
    enableTransparency: true,
    windowOpacity: 85,
    fontFamily: 'system',
    fontSize: 'medium',
  };
  const activeTheme = appearance.theme || 'system';

  // OCR 过滤规则文本域:本地编辑,点「保存规则」一次性写入
  const [ocrFilterDraft, setOcrFilterDraft] = useState<string | null>(null);
  const effectiveFilterDraft =
    ocrFilterDraft !== null ? ocrFilterDraft : (settings.ocrFilterRules ?? []).join('\n');
  const handleSaveFilterRules = () => {
    const rules = effectiveFilterDraft
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    setOcrFilterRules(rules);
    setOcrFilterDraft(null);
  };

  const [ocrStatus, setOcrStatus] = useState<OcrEngineStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    cmdGetOcrEngineStatus()
      .then((s) => { if (!cancelled) setOcrStatus(s); })
      .catch(() => { if (!cancelled) setOcrStatus({ status: 'unknown', detail: 'OCR 引擎状态查询失败（演示环境）' }); });
    return () => { cancelled = true; };
  }, [settings.ocrVersion]);

  // 开机自启是 OS 级注册表/启动项状态（不存 settings.json），挂载时查询真实状态
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    cmdGetAutoStart().then((v) => { if (!cancelled) setAutoStartEnabled(v); });
    return () => { cancelled = true; };
  }, []);
  const handleToggleAutoStart = async (enabled: boolean) => {
    setAutoStartEnabled(enabled);
    try {
      await cmdSetAutoStart(enabled);
    } catch (err) {
      console.warn('设置开机自启失败:', err);
      setAutoStartEnabled(!enabled);
    }
  };

  return (
    <>
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className={`p-5 space-y-5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div>
              <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                <Sliders className="h-4 w-4 text-purple-500" />
                <span>翻译引擎匹配优先级</span>
              </div>
              <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                翻译时将自上而下匹配，排在第 1 位的引擎优先查询，若未匹配则自动回退至下一层级
              </p>
            </div>

            <div className="space-y-2">
              {settings.translationTiers.map((tier, index) => {
                const tierInfo: Record<string, { label: string; desc: string; icon: string }> = {
                  'Preset Dictionary': { label: '专业与自定义字典', desc: '本地离线 0ms 秒匹配，CG 节点/术语精准无误', icon: '🧊' },
                  'LLM API': { label: 'AI 大语言模型', desc: 'DeepSeek / OpenAI 高级润色与长句意译', icon: '🤖' },
                  'Online Fallback': { label: '在线极速通道 (兜底)', desc: 'Google / Bing 免 Key 兜底，保底 100% 吐出结果', icon: '🌐' },
                };
                const info = tierInfo[tier] || { label: tier, desc: '自定义翻译层级', icon: '⚡' };

                return (
                  <div
                    key={tier}
                    className={`flex items-center justify-between rounded-xl p-3 border transition-all ${
                      isLight ? 'bg-slate-50 border-slate-200 hover:border-slate-300 shadow-xs' : 'bg-zinc-950/70 border-white/[0.07] hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-mono font-bold ${
                        isLight ? 'bg-slate-200 text-slate-700' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {index + 1}
                      </span>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                            {info.icon} {tier} ({info.label})
                          </span>
                          {index === 0 && (
                            <span className={`flex items-center space-x-1 rounded-full border px-2 py-0.2 text-[10px] font-bold ${
                              isLight ? 'bg-blue-100 border-blue-300 text-blue-800' : 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                            }`}>
                              <Sparkles className="h-3 w-3" />
                              <span>最先匹配</span>
                            </span>
                          )}
                        </div>
                        <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                          {info.desc}
                        </p>
                      </div>
                    </div>

                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => moveTier(index, index - 1)}
                      disabled={index === 0}
                      className={`rounded-lg p-1.5 disabled:opacity-20 transition cursor-pointer ${
                        isLight ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-800' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                      title="向上移动 (Move Up)"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTier(index, index + 1)}
                      disabled={index === settings.translationTiers.length - 1}
                      className={`rounded-lg p-1.5 disabled:opacity-20 transition cursor-pointer ${
                        isLight ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-800' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                      title="向下移动 (Move Down)"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            </div>

            {/* 软件常规偏好信息 */}
            <div className={`pt-4 border-t space-y-3 ${isLight ? 'border-slate-200' : 'border-white/[0.06]'}`}>
              <h3 className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>界面与系统偏好</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className={`rounded-xl border p-3 text-xs ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className={isLight ? 'text-slate-600 font-medium' : 'text-zinc-400 font-medium'}>默认词库 (Default Preset)</div>
                    <select
                      value={settings.defaultPreset || 'blender'}
                      onChange={(e) => setDefaultPreset(e.target.value)}
                      className={`mt-1.5 w-full rounded-lg border px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none cursor-pointer ${
                        isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.08] text-zinc-100'
                      }`}
                    >
                      <option value="blender">Blender</option>
                      <option value="substance">Substance Painter</option>
                      <option value="unity">Unity</option>
                      <option value="unreal">Unreal Engine</option>
                      <option value="maya">Maya</option>
                      <option value="houdini">Houdini</option>
                      <option value="general">通用模式 (General)</option>
                    </select>
                  </div>
                <div className={`rounded-xl border p-3 text-xs ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className={isLight ? 'text-slate-600 font-medium' : 'text-zinc-400 font-medium'}>当前视觉主题</div>
                  <div className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    {activeTheme === 'light'
                      ? '明亮浅色 (Light)'
                      : activeTheme === 'dark' || (activeTheme as any) === 'fluent-dark'
                      ? '经典深色 (Dark)'
                      : '跟随系统 (System)'}
                  </div>
                </div>
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className={isLight ? 'text-slate-600 font-medium' : 'text-zinc-400 font-medium'}>OCR 文字识别引擎</div>
                    <span
                      className={`text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-full border ${
                        OCR_STATUS_STYLE[ocrStatus?.status || 'unknown']
                      }`}
                    >
                      {ocrStatus ? ocrStatus.status : '...'}
                    </span>
                  </div>
                  <div className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    {ocrStatus ? ocrStatus.detail : '正在查询引擎状态...'}
                  </div>
                </div>

                {/* OCR 识别引擎选择器 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className={`font-medium mb-2 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                    OCR 识别引擎
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    {([
                      {
                        value: 'auto',
                        label: '自动选择',
                        desc: `智能探测：PP-OCR${(settings.ocrVersion || 'v4').toUpperCase()} 优先，自动降级`,
                      },
                      {
                        value: 'onnx',
                        label: `PP-OCR${(settings.ocrVersion || 'v4').toUpperCase()} (推荐)`,
                        desc: 'Rust 原生离线推理，中英排版最佳，无网络依赖',
                      },
                      {
                        value: 'winrt',
                        label: '系统 WinRT OCR',
                        desc: 'Windows 10/11 原生超高速识别 (<15ms 零延迟)',
                      },
                    ] as { value: 'auto' | 'onnx' | 'winrt'; label: string; desc: string }[]).map(({ value, label, desc }) => {
                      const isSelected = (settings.ocrEngine ?? 'auto') === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setOcrEngine(value)}
                          title={desc}
                          className={`text-left rounded-lg border px-2.5 py-2 transition-all cursor-pointer
                            ${isSelected
                              ? (isLight ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-blue-500/60 bg-blue-500/10 text-blue-300')
                              : (isLight ? 'border-slate-200 hover:border-slate-400 text-slate-700' : 'border-white/[0.06] hover:border-white/20 text-zinc-300')
                            }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              isSelected ? 'bg-blue-500' : (isLight ? 'bg-slate-300' : 'bg-zinc-600')
                            }`} />
                            <span className="font-semibold">{label}</span>
                          </div>
                          <div className={`mt-0.5 text-[10px] leading-tight ${
                            isLight ? 'text-slate-500' : 'text-zinc-500'
                          }`}>{desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* OCR 内容过滤 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className={`font-medium ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                        OCR 内容过滤
                      </div>
                      <div className={`mt-0.5 text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                        命中规则的识别块(时间戳/纯数字/水印等)不参与翻译,保持译文区干净。留空使用默认规则集。
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.ocrFilterEnabled ?? true}
                      onClick={() => setOcrFilterEnabled(!(settings.ocrFilterEnabled ?? true))}
                      className={`relative w-11 h-6 rounded-full transition shrink-0 cursor-pointer ${
                        (settings.ocrFilterEnabled ?? true) ? 'bg-emerald-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                      }`}
                      title="开启后:命中规则的文字块直接剔除"
                    >
                      <span className={`absolute top-1 inline-block h-4 w-4 rounded-full bg-white transition-all cursor-pointer ${
                        (settings.ocrFilterEnabled ?? true) ? 'left-6' : 'left-1'
                      }`} />
                    </button>
                  </div>
                  <textarea
                    value={effectiveFilterDraft}
                    onChange={(e) => setOcrFilterDraft(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    placeholder={'默认规则集(留空生效),示例:\n^\\d{1,2}:\\d{2}(:\\d{2})?$   时间\n^\\d+([.,]\\d+)?%?$   纯数字\n^https?://\\S+$   URL'}
                    className={`w-full rounded-lg border px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed resize-y ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-300'
                        : 'bg-zinc-900/60 border-zinc-700 text-zinc-200 placeholder-zinc-600'
                    }`}
                  />
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                      一条正则一行;无效正则自动跳过。保存后整体替换默认规则。
                    </span>
                    <button
                      type="button"
                      onClick={handleSaveFilterRules}
                      disabled={ocrFilterDraft === null}
                      className={`rounded-lg px-2.5 py-1 text-[10.5px] font-semibold transition cursor-pointer ${
                        ocrFilterDraft === null
                          ? 'opacity-40 cursor-not-allowed bg-slate-500 text-white'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}
                    >
                      保存规则
                    </button>
                  </div>
                </div>

                {/* 首选翻译引擎选择器 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className={`font-medium mb-2 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                    首选翻译引擎
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { value: 'auto', label: '自动', desc: '按优先级依次尝试（推荐）' },
                      { value: 'dict', label: '仅词典', desc: '查 CG 专业词典，最快·完全离线' },
                      { value: 'llm', label: '优先 LLM', desc: '跳过词典，直接走 LLM 翻译' },
                      { value: 'online', label: '在线回退', desc: 'Google / MyMemory 等在线引擎' },
                    ] as { value: string; label: string; desc: string }[]).map(({ value, label, desc }) => {
                      const isSelected = (settings.primaryTranslationEngine ?? 'auto') === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPrimaryTranslationEngine(value as 'auto' | 'dict' | 'llm' | 'online')}
                          title={desc}
                          className={`text-left rounded-lg border px-2.5 py-2 transition-all cursor-pointer
                            ${isSelected
                              ? (isLight ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-violet-500/60 bg-violet-500/10 text-violet-300')
                              : (isLight ? 'border-slate-200 hover:border-slate-400 text-slate-700' : 'border-white/[0.06] hover:border-white/20 text-zinc-300')
                            }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              isSelected ? 'bg-violet-500' : (isLight ? 'bg-slate-300' : 'bg-zinc-600')
                            }`} />
                            <span className="font-semibold">{label}</span>
                          </div>
                          <div className={`mt-0.5 text-[10px] leading-tight ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>{desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 关闭窗口行为选择器 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`font-medium ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
                      关闭主窗口行为 (必选项)
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      isLight ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/20 text-blue-300'
                    }`}>
                      系统控制
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {([
                      {
                        value: 'ask',
                        label: '每次询问',
                        desc: '点击关闭时弹出对话框确认（推荐）',
                      },
                      {
                        value: 'minimize',
                        label: '最小化到托盘',
                        desc: '常驻后台，热键随时秒级呼出',
                      },
                      {
                        value: 'exit',
                        label: '直接退出程序',
                        desc: '关闭窗口时直接彻底结束软件',
                      },
                    ] as { value: 'ask' | 'minimize' | 'exit'; label: string; desc: string }[]).map(({ value, label, desc }) => {
                      const isSelected = (settings.closeAction ?? 'ask') === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setCloseAction(value)}
                          title={desc}
                          className={`text-left rounded-lg border p-2.5 transition-all cursor-pointer ${
                            isSelected
                              ? (isLight ? 'border-blue-500 bg-blue-50/80 text-blue-700 ring-1 ring-blue-500/20 shadow-2xs' : 'border-blue-500 bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30')
                              : (isLight ? 'border-slate-200 hover:border-slate-300 bg-white text-slate-700' : 'border-white/[0.06] hover:border-white/15 bg-zinc-900/50 text-zinc-300')
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 flex items-center justify-center border ${
                              isSelected
                                ? (isLight ? 'border-blue-600 bg-blue-600' : 'border-blue-400 bg-blue-400')
                                : (isLight ? 'border-slate-300 bg-white' : 'border-zinc-600 bg-transparent')
                            }`}>
                              {isSelected && <span className="w-1 h-1 rounded-full bg-white" />}
                            </span>
                            <span className="font-semibold text-xs">{label}</span>
                          </div>
                          <div className={`mt-1 text-[10.5px] leading-tight ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                            {desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Spotlight 查词小窗口行为 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`font-medium ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
                      Win 快速查词小窗口 (Spotlight) 行为
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      isLight ? 'bg-purple-100 text-purple-700' : 'bg-purple-500/20 text-purple-300'
                    }`}>
                      快捷悬浮窗
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {([
                      {
                        value: 'hide',
                        label: '按 Esc / 失去焦点自动关闭',
                        desc: '查完即走，丝滑不遮挡 3D/CG 创作工作区',
                      },
                      {
                        value: 'minimize',
                        label: '仅按 Esc 手动关闭',
                        desc: '点击其他窗口时不自动关闭，便于对照参考',
                      },
                    ] as { value: 'hide' | 'minimize'; label: string; desc: string }[]).map(({ value, label, desc }) => {
                      const isSelected = (settings.miniWindowCloseAction ?? 'hide') === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setMiniWindowCloseAction(value)}
                          title={desc}
                          className={`text-left rounded-lg border p-2.5 transition-all cursor-pointer ${
                            isSelected
                              ? (isLight ? 'border-purple-500 bg-purple-50/80 text-purple-700 ring-1 ring-purple-500/20 shadow-2xs' : 'border-purple-500 bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/30')
                              : (isLight ? 'border-slate-200 hover:border-slate-300 bg-white text-slate-700' : 'border-white/[0.06] hover:border-white/15 bg-zinc-900/50 text-zinc-300')
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 flex items-center justify-center border ${
                              isSelected
                                ? (isLight ? 'border-purple-600 bg-purple-600' : 'border-purple-400 bg-purple-400')
                                : (isLight ? 'border-slate-300 bg-white' : 'border-zinc-600 bg-transparent')
                            }`}>
                              {isSelected && <span className="w-1 h-1 rounded-full bg-white" />}
                            </span>
                            <span className="font-semibold text-xs">{label}</span>
                          </div>
                          <div className={`mt-1 text-[10.5px] leading-tight ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                            {desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 系统偏好：开机自启 / 窗口置顶 / 朗读语速 / 手动代理 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className={`font-medium ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
                      系统与网络偏好
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      常驻增强
                    </span>
                  </div>

                  <div className="space-y-3">
                    {/* 开机自启 + 主窗口置顶：两个并排开关 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>开机自动启动</div>
                          <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-600 font-medium' : 'text-zinc-400'}`}>
                            登录 Windows 后自动常驻后台（托盘待命）
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={autoStartEnabled}
                            onChange={(e) => { void handleToggleAutoStart(e.target.checked); }}
                            className="sr-only peer"
                            data-testid="autostart-toggle"
                          />
                          <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>主窗口置顶显示</div>
                          <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-600 font-medium' : 'text-zinc-400'}`}>
                            主翻译窗口始终悬浮于其他窗口之上
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={settings.alwaysOnTop ?? false}
                            onChange={(e) => setAlwaysOnTop(e.target.checked)}
                            className="sr-only peer"
                            data-testid="always-on-top-toggle"
                          />
                          <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      </div>
                    </div>

                    {/* TTS 朗读语速 */}
                    <div className={`space-y-2 p-3 rounded-lg border ${
                      isLight ? 'bg-slate-100/90 border-slate-200' : 'bg-zinc-950/60 border-white/[0.06]'
                    }`}>
                      <div className="flex justify-between text-xs">
                        <span className={`font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-300'}`}>朗读语速 (TTS Speech Rate)</span>
                        <span className="font-mono text-blue-600 font-bold">
                          {(settings.ttsRate ?? 1.0).toFixed(1)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={settings.ttsRate ?? 1.0}
                        onChange={(e) => setTtsRate(Number(e.target.value))}
                        className="w-full h-1.5 bg-zinc-300 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        data-testid="tts-rate-slider"
                      />
                      <div className={`flex justify-between text-[10px] pt-0.5 ${isLight ? 'text-slate-600 font-medium' : 'text-zinc-400'}`}>
                        <span>0.5x (慢速跟读)</span>
                        <span>1.0x (自然语速)</span>
                        <span>2.0x (快速复习)</span>
                      </div>
                    </div>

                    {/* 手动代理 */}
                    <div className={`space-y-2 p-3 rounded-lg border ${
                      isLight ? 'bg-slate-100/90 border-slate-200' : 'bg-zinc-950/60 border-white/[0.06]'
                    }`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className={`text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-300'}`}>手动网络代理 (HTTP/SOCKS5)</div>
                          <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-600 font-medium' : 'text-zinc-400'}`}>
                            访问 OpenAI / Gemini 等境外接口时指定代理，优先于系统代理自动探测
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={settings.proxyEnabled ?? false}
                            onChange={(e) => setProxyEnabled(e.target.checked)}
                            className="sr-only peer"
                            data-testid="proxy-toggle"
                          />
                          <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      </div>
                      {(settings.proxyEnabled ?? false) && (
                        <input
                          type="text"
                          value={settings.proxyUrl ?? ''}
                          onChange={(e) => setProxyUrl(e.target.value)}
                          placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                          spellCheck={false}
                          data-testid="proxy-url-input"
                          className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono outline-none transition ${
                            isLight
                              ? 'bg-white border-slate-300 focus:border-blue-500 text-slate-800'
                              : 'bg-zinc-900 border-white/10 focus:border-blue-500 text-zinc-200'
                          }`}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* 软件信息 / 关于卡片入口 */}
                <div className="pt-2">
                  <div className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                    isLight ? 'bg-gradient-to-r from-blue-50/80 to-indigo-50/80 border-blue-200' : 'bg-gradient-to-r from-blue-950/20 to-indigo-950/20 border-blue-500/20'
                  }`}>
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-lg shrink-0">
                        🐾
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold flex items-center space-x-1.5 flex-wrap">
                          <span>猫步翻译 (Maobu Translator)</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold">v{APP_VERSION}</span>
                        </div>
                        <p className={`text-[11px] mt-0.5 truncate ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                          基于 React 19 + Rust Tauri v2 · 专为 3D/CG 与多语种打造的下一代翻译利器
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent("open-onboarding"))}
                      className="lg-btn lg-btn-primary !px-3 !py-1.5 !text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      <span>📖 重看新手引导</span>
                    </button>
                    {onOpenAbout && (
                      <button
                        type="button"
                        onClick={onOpenAbout}
                        className="lg-btn lg-btn-primary !px-3 !py-1.5 !text-xs font-semibold shrink-0 cursor-pointer"
                      >
                        <span>查看软件信息与架构 ➔</span>
                      </button>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
    </>
  );
};
