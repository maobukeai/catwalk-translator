import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle, ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Save, CheckCircle2,
  Camera, Zap, Bot, BookOpen, Sliders, Sparkles, ShieldCheck, Globe, Palette,
  Sun, Moon, Monitor, Plus, Trash2, Edit3, Search, Download, Upload, X,
  FileSpreadsheet, Copy, Check, Type, Languages, Tag, FileText, WifiOff,
  HardDriveDownload, CloudUpload, Power,
} from 'lucide-react';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import {
  cmdGetOcrEngineStatus, cmdFetchLlmModels, cmdOfflineStatus, cmdOfflineInstall,
  cmdOfflineUninstall, cmdGetAutoStart, cmdSetAutoStart,
} from '../../../services/tauri';
import type { OfflineEngineStatus } from '../../../services/tauri';
import { normalizeHotkeyForCompare } from '../../../services/hotkeys';
import { buildCaptureEngineChoices, findEngineOption } from '../../../services/engineOptions';
import { useLlmPanelState, PROVIDER_DEFAULT_ENDPOINTS } from './useLlmPanelState';
import type {
  LlmConfig, OcrEngineStatus, ThemeMode, FontFamilyOption, FontSizeOption, CustomDictItem,
} from '../../../services/types';

const isTestEnv = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
interface HotkeyPanelProps {
  onStartCapture?: () => void;
  onTriggerSpotlight?: () => void;
  onTriggerClipboard?: () => void;
  onToggleWindow?: () => void;
}

/** 快捷键与 AI 模型：四个全局热键录制(含冲突检测)、LLM 多模型池与连接测试 */
export const HotkeyPanel: React.FC<HotkeyPanelProps> = ({
  onStartCapture,
  onTriggerSpotlight,
  onTriggerClipboard,
  onToggleWindow,
}) => {
  const { isLight } = useAppTheme();
  const {
    settings,
    setHotkey,
    setSpotlightHotkey,
    setClipboardHotkey,
    setToggleWindowHotkey,
    setCaptureHotkeyEnabled,
    setSpotlightHotkeyEnabled,
    setClipboardHotkeyEnabled,
    setToggleWindowHotkeyEnabled,
    setCaptureReleaseAction,
    setClipboardWatchEnabled,
    setWatchIntervalMs,
    setSelectionLookupEnabled,
    setHoverLookupEnabled,
    setHoverLookupModifier,
    setCaptureEngine,
  } = useSettingsStore();

  // LLM 模型池 UI 同时出现在本区与「在线引擎」区,共用一份状态逻辑
  const {
    settings: _llmSettings,
    llm,
    llmPool,
    showApiKey,
    setShowApiKey,
    testLatency,
    testStatus,
    testSuccess,
    isTestingLlm,
    showModelPicker,
    setShowModelPicker,
    isFetchingModels,
    fetchedModels,
    fetchModelNotice,
    handleProviderChange,
    handleAddModel,
    handleTestLlmConnection,
    handleFetchModels,
    setLlmConfig,
    addLlmConfig,
    updateLlmConfig,
    deleteLlmConfig,
    setActiveLlmConfig,
    toggleLlmConfigEnabled,
  } = useLlmPanelState();
  void _llmSettings; void setShowApiKey; void setShowModelPicker; void setLlmConfig;
  void addLlmConfig; void updateLlmConfig; void setActiveLlmConfig; void toggleLlmConfigEnabled;

  const [recordingTarget, setRecordingTarget] = useState<'capture' | 'spotlight' | 'clipboard' | 'toggleWindow' | null>(null);

  // 快捷键冲突提示（录制到与其他功能重复的组合时显示，4 秒后自动消失）
  const [hotkeyConflictNotice, setHotkeyConflictNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!hotkeyConflictNotice) return;
    const timer = setTimeout(() => setHotkeyConflictNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [hotkeyConflictNotice]);

  useEffect(() => {
    if (!recordingTarget) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingTarget(null);
        return;
      }

      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        return;
      }

      const keys: string[] = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.metaKey) keys.push('Win');

      let mainKey = e.key.toUpperCase();
      if (e.code.startsWith('Key')) {
        mainKey = e.code.replace('Key', '');
      } else if (e.code.startsWith('Digit')) {
        mainKey = e.code.replace('Digit', '');
      } else if (e.code.startsWith('F') && e.code.length <= 4) {
        mainKey = e.code;
      }

      if (mainKey && !['CONTROL', 'ALT', 'SHIFT', 'META'].includes(mainKey)) {
        if (!keys.includes(mainKey)) {
          keys.push(mainKey);
        }
      }

      if (keys.length > 0) {
        const combo = keys.join('+');

        // 与其他三个快捷键做冲突检测（归一化比较：忽略大小写与修饰键顺序）
        const normalizedCombo = normalizeHotkeyForCompare(combo);
        const conflict = (
          [
            { target: 'capture', label: '全局划词选区', value: settings.hotkey || 'F4' },
            { target: 'spotlight', label: 'Spotlight 查词', value: settings.spotlightHotkey || 'Alt+Space' },
            { target: 'clipboard', label: '剪贴板静默翻译', value: settings.clipboardHotkey || 'Ctrl+Shift+C' },
            { target: 'toggleWindow', label: '唤醒/隐藏主程序', value: settings.toggleWindowHotkey || 'Alt+Q' },
          ] as { target: string; label: string; value: string }[]
        ).find(
          (o) => o.target !== recordingTarget && normalizeHotkeyForCompare(o.value) === normalizedCombo
        );
        if (conflict) {
          setHotkeyConflictNotice(`⚠️ 「${combo}」已绑定于「${conflict.label}」（${conflict.value}），请换一组组合`);
          setRecordingTarget(null);
          return;
        }
        setHotkeyConflictNotice(null);

        if (recordingTarget === 'capture') setHotkey(combo);
        else if (recordingTarget === 'spotlight') setSpotlightHotkey(combo);
        else if (recordingTarget === 'clipboard') setClipboardHotkey(combo);
        else if (recordingTarget === 'toggleWindow') setToggleWindowHotkey(combo);

        setRecordingTarget(null);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [recordingTarget, setHotkey, setSpotlightHotkey, setClipboardHotkey, setToggleWindowHotkey, settings.hotkey, settings.spotlightHotkey, settings.clipboardHotkey, settings.toggleWindowHotkey]);


  return (
    <>
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className={`p-4 space-y-3.5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div>
              <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                <Zap className="h-4 w-4 text-blue-500" />
                <span>全局划词快捷键</span>
              </div>
              <p className={`mt-0.5 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                按下快捷键后瞬间截取桌面背景并调出高精度划词选区蒙版。
              </p>
            </div>

            {hotkeyConflictNotice && (
              <div className={`rounded-lg border px-3 py-2 text-[11px] font-medium ${
                isLight ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-amber-500/10 border-amber-500/40 text-amber-300'
              }`} data-testid="hotkey-conflict-notice">
                {hotkeyConflictNotice}
              </div>
            )}

            {/* 全局快捷键控制中心 - 紧凑型 2x2 网格 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* 1. 全局划词选区 */}
              <div className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                isLight ? 'bg-white/80 border-slate-200/90 shadow-2xs hover:border-blue-300' : 'bg-zinc-950/60 border-white/[0.08] shadow-2xs hover:border-blue-500/30'
              }`}>
                <div className="flex items-center space-x-2 min-w-0 mr-2">
                  <span className={`text-xs p-1.5 rounded-lg shrink-0 select-none ${
                    isLight ? 'bg-blue-50 text-blue-600 border border-blue-200/80' : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  }`}>📸</span>
                  <div className="min-w-0">
                    <div className={`text-xs font-bold leading-tight ${isLight ? 'text-slate-800' : 'text-zinc-100'} truncate`}>全局划词选区</div>
                    <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-400'} truncate mt-0.5`}>全屏鼠标划词与擦除</div>
                  </div>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <kbd
                    onClick={() => setRecordingTarget(recordingTarget === 'capture' ? null : 'capture')}
                    className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold tracking-wide transition-all shadow-2xs cursor-pointer border ${
                      recordingTarget === 'capture'
                        ? 'bg-blue-600/20 text-blue-600 border-blue-500 animate-pulse ring-2 ring-blue-500/20'
                        : (isLight ? 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50' : 'bg-zinc-900 text-blue-400 border-blue-500/40 hover:bg-zinc-800')
                    } ${!(settings.captureHotkeyEnabled ?? true) ? 'opacity-40 line-through' : ''}`}
                    title="点击开始录制按键"
                  >
                    {recordingTarget === 'capture' ? '⌨️ 请按下按键...' : settings.hotkey || 'F4'}
                  </kbd>

                  <button
                    type="button"
                    onClick={() => setRecordingTarget(recordingTarget === 'capture' ? null : 'capture')}
                    className={`px-1.5 py-0.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
                      recordingTarget === 'capture'
                        ? 'bg-rose-500/20 text-rose-600 border-rose-300'
                        : (isLight ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50' : 'bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700')
                    }`}
                  >
                    {recordingTarget === 'capture' ? '取消' : '重新录制'}
                  </button>

                  {onStartCapture && (
                    <button
                      type="button"
                      onClick={onStartCapture}
                      className="px-1.5 py-0.5 rounded-md bg-blue-600/10 hover:bg-blue-600/20 text-blue-600 dark:text-sky-400 text-[11px] font-semibold border border-blue-500/30 transition cursor-pointer"
                    >
                      🚀 测试
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setCaptureHotkeyEnabled(!(settings.captureHotkeyEnabled ?? true))}
                    className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-0.5 ${
                      (settings.captureHotkeyEnabled ?? true) ? 'bg-blue-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                    }`}
                    title="开启或关闭该快捷键"
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      (settings.captureHotkeyEnabled ?? true) ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>

              {/* 2. Spotlight 居中查词 */}
              <div className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                isLight ? 'bg-white/80 border-slate-200/90 shadow-2xs hover:border-purple-300' : 'bg-zinc-950/60 border-white/[0.08] shadow-2xs hover:border-purple-500/30'
              }`}>
                <div className="flex items-center space-x-2 min-w-0 mr-2">
                  <span className={`text-xs p-1.5 rounded-lg shrink-0 select-none ${
                    isLight ? 'bg-purple-50 text-purple-600 border border-purple-200/80' : 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                  }`}>🔍</span>
                  <div className="min-w-0">
                    <div className={`text-xs font-bold leading-tight ${isLight ? 'text-slate-800' : 'text-zinc-100'} truncate`}>Spotlight 居中查词</div>
                    <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-400'} truncate mt-0.5`}>中央弹框打字查词</div>
                  </div>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <kbd
                    onClick={() => setRecordingTarget(recordingTarget === 'spotlight' ? null : 'spotlight')}
                    className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold tracking-wide transition-all shadow-2xs cursor-pointer border ${
                      recordingTarget === 'spotlight'
                        ? 'bg-purple-600/20 text-purple-600 border-purple-500 animate-pulse ring-2 ring-purple-500/20'
                        : (isLight ? 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50' : 'bg-zinc-900 text-purple-400 border-purple-500/40 hover:bg-zinc-800')
                    } ${!(settings.spotlightHotkeyEnabled ?? false) ? 'opacity-40 line-through' : ''}`}
                    title="点击开始录制按键"
                  >
                    {recordingTarget === 'spotlight' ? '⌨️ 请按下按键...' : settings.spotlightHotkey || 'Alt+Space'}
                  </kbd>

                  <button
                    type="button"
                    onClick={() => setRecordingTarget(recordingTarget === 'spotlight' ? null : 'spotlight')}
                    className={`px-1.5 py-0.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
                      recordingTarget === 'spotlight'
                        ? 'bg-rose-500/20 text-rose-600 border-rose-300'
                        : (isLight ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50' : 'bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700')
                    }`}
                  >
                    {recordingTarget === 'spotlight' ? '取消' : '重新录制'}
                  </button>

                  {onTriggerSpotlight && (
                    <button
                      type="button"
                      onClick={onTriggerSpotlight}
                      className="px-1.5 py-0.5 rounded-md bg-purple-600/10 hover:bg-purple-600/20 text-purple-600 dark:text-purple-400 text-[11px] font-semibold border border-purple-500/30 transition cursor-pointer"
                    >
                      🚀 测试
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setSpotlightHotkeyEnabled(!(settings.spotlightHotkeyEnabled ?? false))}
                    className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-0.5 ${
                      (settings.spotlightHotkeyEnabled ?? false) ? 'bg-purple-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                    }`}
                    title="开启或关闭该快捷键"
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      (settings.spotlightHotkeyEnabled ?? false) ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>

              {/* 3. 剪贴板静默翻译 */}
              <div className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                isLight ? 'bg-white/80 border-slate-200/90 shadow-2xs hover:border-emerald-300' : 'bg-zinc-950/60 border-white/[0.08] shadow-2xs hover:border-emerald-500/30'
              }`}>
                <div className="flex items-center space-x-2 min-w-0 mr-2">
                  <span className={`text-xs p-1.5 rounded-lg shrink-0 select-none ${
                    isLight ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/80' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  }`}>📋</span>
                  <div className="min-w-0">
                    <div className={`text-xs font-bold leading-tight ${isLight ? 'text-slate-800' : 'text-zinc-100'} truncate`}>剪贴板静默翻译</div>
                    <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-400'} truncate mt-0.5`}>读取剪贴板右下角弹出</div>
                  </div>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <kbd
                    onClick={() => setRecordingTarget(recordingTarget === 'clipboard' ? null : 'clipboard')}
                    className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold tracking-wide transition-all shadow-2xs cursor-pointer border ${
                      recordingTarget === 'clipboard'
                        ? 'bg-emerald-600/20 text-emerald-600 border-emerald-500 animate-pulse ring-2 ring-emerald-500/20'
                        : (isLight ? 'bg-white text-emerald-600 border-emerald-300 hover:bg-emerald-50' : 'bg-zinc-900 text-emerald-400 border-emerald-500/40 hover:bg-zinc-800')
                    } ${!(settings.clipboardHotkeyEnabled ?? false) ? 'opacity-40 line-through' : ''}`}
                    title="点击开始录制按键"
                  >
                    {recordingTarget === 'clipboard' ? '⌨️ 请按下按键...' : settings.clipboardHotkey || 'Ctrl+Shift+C'}
                  </kbd>

                  <button
                    type="button"
                    onClick={() => setRecordingTarget(recordingTarget === 'clipboard' ? null : 'clipboard')}
                    className={`px-1.5 py-0.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
                      recordingTarget === 'clipboard'
                        ? 'bg-rose-500/20 text-rose-600 border-rose-300'
                        : (isLight ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50' : 'bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700')
                    }`}
                  >
                    {recordingTarget === 'clipboard' ? '取消' : '重新录制'}
                  </button>

                  {onTriggerClipboard && (
                    <button
                      type="button"
                      onClick={onTriggerClipboard}
                      className="px-1.5 py-0.5 rounded-md bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold border border-emerald-500/30 transition cursor-pointer"
                    >
                      🚀 测试
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setClipboardHotkeyEnabled(!(settings.clipboardHotkeyEnabled ?? false))}
                    className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-0.5 ${
                      (settings.clipboardHotkeyEnabled ?? false) ? 'bg-emerald-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                    }`}
                    title="开启或关闭该快捷键"
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      (settings.clipboardHotkeyEnabled ?? false) ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>

              {/* 4. 唤醒 / 隐藏主程序 */}
              <div className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                isLight ? 'bg-white/80 border-slate-200/90 shadow-2xs hover:border-amber-300' : 'bg-zinc-950/60 border-white/[0.08] shadow-2xs hover:border-amber-500/30'
              }`}>
                <div className="flex items-center space-x-2 min-w-0 mr-2">
                  <span className={`text-xs p-1.5 rounded-lg shrink-0 select-none ${
                    isLight ? 'bg-amber-50 text-amber-600 border border-amber-200/80' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  }`}>⚡</span>
                  <div className="min-w-0">
                    <div className={`text-xs font-bold leading-tight ${isLight ? 'text-slate-800' : 'text-zinc-100'} truncate`}>唤醒 / 隐藏主程序</div>
                    <div className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-400'} truncate mt-0.5`}>托盘后台与前台秒切</div>
                  </div>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <kbd
                    onClick={() => setRecordingTarget(recordingTarget === 'toggleWindow' ? null : 'toggleWindow')}
                    className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold tracking-wide transition-all shadow-2xs cursor-pointer border ${
                      recordingTarget === 'toggleWindow'
                        ? 'bg-amber-600/20 text-amber-600 border-amber-500 animate-pulse ring-2 ring-amber-500/20'
                        : (isLight ? 'bg-white text-amber-600 border-amber-300 hover:bg-amber-50' : 'bg-zinc-900 text-amber-400 border-amber-500/40 hover:bg-zinc-800')
                    } ${!(settings.toggleWindowHotkeyEnabled ?? false) ? 'opacity-40 line-through' : ''}`}
                    title="点击开始录制按键"
                  >
                    {recordingTarget === 'toggleWindow' ? '⌨️ 请按下按键...' : settings.toggleWindowHotkey || 'Alt+Q'}
                  </kbd>

                  <button
                    type="button"
                    onClick={() => setRecordingTarget(recordingTarget === 'toggleWindow' ? null : 'toggleWindow')}
                    className={`px-1.5 py-0.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
                      recordingTarget === 'toggleWindow'
                        ? 'bg-rose-500/20 text-rose-600 border-rose-300'
                        : (isLight ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50' : 'bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700')
                    }`}
                  >
                    {recordingTarget === 'toggleWindow' ? '取消' : '重新录制'}
                  </button>

                  {onToggleWindow && (
                    <button
                      type="button"
                      onClick={onToggleWindow}
                      className="px-1.5 py-0.5 rounded-md bg-amber-600/10 hover:bg-amber-600/20 text-amber-600 dark:text-amber-400 text-[11px] font-semibold border border-amber-500/30 transition cursor-pointer"
                    >
                      🚀 测试
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setToggleWindowHotkeyEnabled(!(settings.toggleWindowHotkeyEnabled ?? false))}
                    className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-0.5 ${
                      (settings.toggleWindowHotkeyEnabled ?? false) ? 'bg-amber-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                    }`}
                    title="开启或关闭该快捷键"
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      (settings.toggleWindowHotkeyEnabled ?? false) ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>
            </div>

            {/* 截图划词首选翻译引擎 / AI大模型选择器 */}
            <div className={`pt-2 border-t space-y-1.5 ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                截图划词首选 AI 模型 / 翻译通道
              </label>
              <select
                value={settings.captureEngine || 'auto'}
                onChange={(e) => setCaptureEngine(e.target.value)}
                className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none cursor-pointer font-medium ${
                  isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/15 text-zinc-100'
                }`}
              >
                {(() => {
                  const choices = buildCaptureEngineChoices(settings);
                  const legacy = settings.captureEngine && !findEngineOption(choices, settings.captureEngine)
                    ? { value: settings.captureEngine, label: `⚙️ ${settings.captureEngine}（旧版通道，重新选择即更新）` }
                    : null;
                  return (
                    <>
                      <option value={choices.auto.value}>{choices.auto.label}</option>
                      {legacy && <option value={legacy.value}>{legacy.label}</option>}
                      {choices.groups.map((g) => (
                        <optgroup key={g.key} label={`── ${g.label} ──`}>
                          {g.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </>
                  );
                })()}
              </select>
              <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                框选截图后将直接调用所选 AI 模型进行识别翻译，也可在划词浮层顶部随时秒切。
              </p>
            </div>

            {/* 截图翻译体验：松手行为 + 区域监控间隔 */}
            <div className={`pt-2 border-t space-y-3 ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    划框松手后的行为
                  </label>
                  <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                    「先调整」松手后选区保留 8 个控制点，可缩放/移动/方向键微调，按 Enter 再识别；「立即识别」保留旧版松手即译。
                  </p>
                </div>
                <div className="flex items-center p-0.5 rounded-xl border shrink-0">
                  {([
                    { value: 'adjust', label: '⏸ 先调整' },
                    { value: 'auto', label: '⚡ 立即识别' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`release-action-${opt.value}`}
                      onClick={() => setCaptureReleaseAction(opt.value)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        (settings.captureReleaseAction ?? 'auto') === opt.value
                          ? 'bg-sky-500 text-white shadow'
                          : (isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-zinc-300 hover:bg-white/10')
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    剪贴板被动监听（复制即翻译）
                  </label>
                  <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                    后台监听剪贴板变化，复制外文文本自动弹出译文 Toast。数字/重复内容自动忽略，划词期间静默。
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="clipboard-watch-toggle"
                  role="switch"
                  aria-checked={settings.clipboardWatchEnabled ?? false}
                  onClick={() => setClipboardWatchEnabled(!(settings.clipboardWatchEnabled ?? false))}
                  className={`relative w-11 h-6 rounded-full transition shrink-0 cursor-pointer ${
                    (settings.clipboardWatchEnabled ?? false) ? 'bg-emerald-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                  }`}
                  title="开启后：在任意软件中复制外文文本即自动翻译"
                >
                  <span className={`absolute top-1 inline-block h-4 w-4 rounded-full bg-white transition-all cursor-pointer ${
                    (settings.clipboardWatchEnabled ?? false) ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    划词即弹窗（选中即翻译）
                  </label>
                  <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                    在任意软件中拖选或双击选中文字，自动弹出翻译浮窗；取词后自动恢复剪贴板原内容。
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="selection-lookup-toggle"
                  role="switch"
                  aria-checked={settings.selectionLookupEnabled ?? false}
                  onClick={() => setSelectionLookupEnabled(!(settings.selectionLookupEnabled ?? false))}
                  className={`relative w-11 h-6 rounded-full transition shrink-0 cursor-pointer ${
                    (settings.selectionLookupEnabled ?? false) ? 'bg-emerald-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                  }`}
                  title="开启后：拖选/双击选中文字即自动弹出翻译浮窗"
                >
                  <span className={`absolute top-1 inline-block h-4 w-4 rounded-full bg-white transition-all cursor-pointer ${
                    (settings.selectionLookupEnabled ?? false) ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    修饰键悬停取词
                  </label>
                  <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                    按住修饰键并把鼠标停在屏幕文字上，自动识别并弹出词卡（OCR 实时取词，全应用通用）。
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={settings.hoverLookupModifier ?? 'ctrl'}
                    onChange={(e) => setHoverLookupModifier(e.target.value as 'ctrl' | 'alt' | 'shift')}
                    className={`rounded-lg border px-2 py-1 text-[11px] ${
                      isLight ? 'bg-white border-slate-300 text-slate-700' : 'bg-zinc-900/60 border-zinc-700 text-zinc-200'
                    }`}
                    title="悬停取词使用的修饰键"
                  >
                    <option value="ctrl">Ctrl</option>
                    <option value="alt">Alt</option>
                    <option value="shift">Shift</option>
                  </select>
                  <button
                    type="button"
                    data-testid="hover-lookup-toggle"
                    role="switch"
                    aria-checked={settings.hoverLookupEnabled ?? false}
                    onClick={() => setHoverLookupEnabled(!(settings.hoverLookupEnabled ?? false))}
                    className={`relative w-11 h-6 rounded-full transition shrink-0 cursor-pointer ${
                      (settings.hoverLookupEnabled ?? false) ? 'bg-emerald-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                    }`}
                    title="开启后：按住修饰键悬停屏幕文字即弹出词卡"
                  >
                    <span className={`absolute top-1 inline-block h-4 w-4 rounded-full bg-white transition-all cursor-pointer ${
                      (settings.hoverLookupEnabled ?? false) ? 'left-6' : 'left-1'
                    }`} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    区域监控刷新间隔 (W 键)
                  </label>
                  <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                    盯游戏数值 / 直播弹幕时每隔几秒自动重新识别翻译。
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="range"
                    min={1000}
                    max={10000}
                    step={500}
                    value={settings.watchIntervalMs ?? 3000}
                    onChange={(e) => setWatchIntervalMs(Number(e.target.value))}
                    className="w-32 accent-sky-500 cursor-pointer"
                    data-testid="watch-interval-slider"
                  />
                  <span className={`text-xs font-mono font-bold w-12 text-right ${isLight ? 'text-slate-700' : 'text-zinc-200'}`} data-testid="watch-interval-label">
                    {((settings.watchIntervalMs ?? 3000) / 1000).toFixed(1)}s
                  </span>
                </div>
              </div>
            </div>

            <div className={`rounded-xl border p-3.5 text-xs space-y-2 ${
              isLight ? 'bg-blue-50/80 border-blue-200 text-blue-900' : 'bg-gradient-to-br from-blue-950/30 to-indigo-950/20 border-blue-500/20 text-zinc-300'
            }`}>
              <div className="flex items-center space-x-2 font-semibold text-blue-600">
                <Sparkles className="h-4 w-4 text-blue-500" />
                <span>快捷键与划词提示：</span>
              </div>
              <ul className={`space-y-1 leading-relaxed ${isLight ? 'text-blue-800' : 'text-zinc-400'}`}>
                <li className="flex items-center space-x-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0"></span>
                  <span>推荐使用如 <kbd className="text-blue-700 bg-blue-100 border border-blue-300 px-1.5 py-0.5 rounded font-mono text-[11px]">F8</kbd> 或 <kbd className="text-blue-700 bg-blue-100 border border-blue-300 px-1.5 py-0.5 rounded font-mono text-[11px]">Ctrl+Shift+D</kbd> 等不与主程序冲突的组合键。</span>
                </li>
                <li className="flex items-center space-x-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0"></span>
                  <span>划词模式开启后，可在全屏选区顶部气泡工具栏直接下拉秒切 AI 模型与通道。</span>
                </li>
              </ul>
            </div>
          </div>

          {/* AI 大语言模型服务配置 (LLM) */}
          <div className={`p-5 space-y-5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                  <Bot className="h-4 w-4 text-indigo-500" />
                  <span>AI 大语言模型服务配置 (LLM)</span>
                </div>
                <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                  支持 DeepSeek / OpenAI / 本地私有化 Ollama / 智谱 GLM / 自定义兼容接口
                </p>
              </div>

              <div className="flex items-center gap-2 flex-nowrap shrink-0 whitespace-nowrap">
                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={isFetchingModels || !llm.endpoint}
                  className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer ${
                    isLight
                      ? 'bg-slate-100 border-slate-300 text-blue-700 hover:bg-slate-200'
                      : 'bg-zinc-800/90 border-white/10 text-blue-300 hover:bg-zinc-700 hover:text-white'
                  }`}
                  title="自动向 endpoint/models 发起 GET 请求拉取所有可用模型"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isFetchingModels ? 'animate-spin' : ''}`} />
                  <span>{isFetchingModels ? '拉取模型中...' : '拉取所有可用模型'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleTestLlmConnection}
                  disabled={isTestingLlm}
                  className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer ${
                    isLight
                      ? 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200'
                      : 'bg-zinc-800/90 border-white/[0.08] text-zinc-200 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  <span>{isTestingLlm ? '测试中...' : '测试连通性'}</span>
                  {testLatency !== null && testSuccess && (
                    <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/20 border border-emerald-400/30 px-1.5 py-0.2 rounded-full">
                      {testLatency}ms
                    </span>
                  )}
                  {testSuccess === false && (
                    <span className="text-[10px] font-mono font-bold text-rose-400 bg-rose-500/20 border border-rose-400/30 px-1.5 py-0.2 rounded-full">
                      失败
                    </span>
                  )}
                </button>
              </div>

              {(testStatus || fetchModelNotice) && (
                <span className={`self-start sm:self-center max-w-[340px] truncate text-[10px] font-mono font-semibold ${
                  testSuccess === false || (fetchModelNotice && fetchModelNotice.includes('失败'))
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}>
                  {fetchModelNotice || testStatus}
                </span>
              )}
            </div>

            {/* 多模型配置池 */}
            <div className={`rounded-2xl border p-4 space-y-3 ${
              isLight ? 'bg-slate-50/80 border-slate-200' : 'bg-zinc-950/60 border-white/[0.08]'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <span className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                    模型配置池
                  </span>
                  <span className={`text-[10px] font-mono font-semibold px-2 py-0.2 rounded-full border ${
                    isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/15 border-blue-400/30 text-blue-300'
                  }`}>
                    {llmPool.length} 个已保存
                  </span>
                  {llm.id && (
                    <span className={`text-[10px] font-mono px-2 py-0.2 rounded-full border ${
                      isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                    }`}>
                      ★ 当前激活
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-1.5">
                  {showModelPicker && (
                    <div className={`flex items-center space-x-1 p-1 rounded-xl border ${
                      isLight ? 'bg-white border-slate-300 shadow-xs' : 'bg-zinc-900 border-white/15 shadow-xs'
                    }`}>
                      {Object.keys(PROVIDER_DEFAULT_ENDPOINTS).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleAddModel(p)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer whitespace-nowrap ${
                            isLight
                              ? 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                              : 'text-zinc-300 hover:bg-blue-500/20 hover:text-blue-300'
                          }`}
                        >
                          + {p}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowModelPicker(!showModelPicker)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                      showModelPicker
                        ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                        : (isLight
                            ? 'bg-white border-slate-300 text-blue-700 hover:bg-blue-50'
                            : 'bg-zinc-800 border-white/15 text-blue-300 hover:bg-zinc-700')
                    }`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加模型
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {llmPool.map((m) => {
                  const isActive = llm.id ? m.id === llm.id : m.provider === llm.provider && m.model === llm.model;
                  const isModelEnabled = m.enabled ?? true;
                  return (
                    <div
                      key={m.id || `${m.provider}-${m.model}-${m.endpoint}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => m.id && setActiveLlmConfig(m.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && m.id) setActiveLlmConfig(m.id); }}
                      className={`group flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl border text-[11px] font-medium transition-all cursor-pointer select-none ${
                        !isModelEnabled
                          ? isLight
                            ? 'bg-slate-100/90 text-slate-400 border-slate-200 opacity-60 hover:opacity-100'
                            : 'bg-zinc-900/40 text-zinc-500 border-white/5 opacity-50 hover:opacity-90'
                          : isActive
                            ? isLight
                              ? 'bg-blue-600 text-white border-blue-400 shadow-md ring-2 ring-blue-500/25'
                              : 'bg-blue-600 text-white border-blue-400/60 shadow-md ring-2 ring-blue-500/30'
                            : isLight
                              ? 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50/60'
                              : 'bg-zinc-900/80 text-zinc-300 border-white/10 hover:border-blue-400/40 hover:bg-zinc-800'
                      }`}
                      title={isModelEnabled ? '点击切换为激活模型（状态：已启用）' : '点击切换为激活模型（状态：已停用）'}
                    >
                      <span className={`font-mono font-medium max-w-[200px] truncate ${
                        isActive && isModelEnabled ? 'text-white' : isModelEnabled ? (isLight ? 'text-blue-700 font-semibold' : 'text-blue-300 font-semibold') : 'line-through text-zinc-400'
                      }`}>
                        {m.model || m.provider || '(未指定模型)'}
                      </span>
                      {!isModelEnabled ? (
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-normal ${
                          isLight ? 'bg-slate-200 text-slate-600' : 'bg-zinc-800 text-zinc-400'
                        }`}>
                          已停用
                        </span>
                      ) : (
                        !!m.apiKey && (
                          <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-300' : 'bg-emerald-500'}`} title="已配置 API Key" />
                        )
                      )}

                      {/* 胶囊快速开关 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (m.id) toggleLlmConfigEnabled(m.id);
                        }}
                        className={`p-1 rounded-lg transition cursor-pointer ${
                          isModelEnabled
                            ? isActive
                              ? 'hover:bg-white/20 text-emerald-300 hover:text-white'
                              : isLight
                                ? 'hover:bg-emerald-50 text-emerald-600'
                                : 'hover:bg-emerald-500/20 text-emerald-400'
                            : isLight
                              ? 'hover:bg-slate-200 text-slate-400 hover:text-slate-700'
                              : 'hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200'
                        }`}
                        title={isModelEnabled ? '点击停用该模型' : '点击启用该模型'}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>

                      {llmPool.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); if (m.id) deleteLlmConfig(m.id); }}
                          className={`p-1 rounded-lg transition cursor-pointer opacity-60 hover:opacity-100 ${
                            isActive && isModelEnabled ? 'hover:bg-white/20 text-white' : (isLight ? 'hover:bg-rose-50 text-rose-500' : 'hover:bg-rose-500/20 text-rose-400')
                          }`}
                          title={isActive ? '删除当前激活模型（自动切换）' : '删除该模型'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {llmPool.length === 0 && (
                  <span className={`text-[11px] py-2 ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                    暂无已保存模型，点击右上角「添加模型」创建第一个配置。
                  </span>
                )}
              </div>

              <p className={`text-[10px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                支持 DeepSeek / OpenAI / 本地私有化 Ollama / 智谱 GLM / 自定义兼容接口。每个模型均支持独立开启/关闭，点击电源图标或下方开关可快速启停，关闭后将暂停调用该模型。
              </p>
            </div>

            {/* 当前激活模型启停控制栏 */}
            <div className={`flex items-center justify-between p-3.5 rounded-2xl border ${
              isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-zinc-950/40 border-white/[0.06]'
            }`}>
              <div className="min-w-0">
                <div className="flex items-center space-x-2">
                  <span className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                    启用当前模型
                  </span>
                  <span className={`text-[10px] font-medium px-2 py-0.2 rounded-full border ${
                    (llm.enabled ?? true)
                      ? isLight
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                      : isLight
                        ? 'bg-slate-100 border-slate-200 text-slate-500'
                        : 'bg-white/5 border-white/10 text-zinc-400'
                  }`}>
                    {(llm.enabled ?? true) ? '已开启' : '已停用'}
                  </span>
                </div>
                <p className={`mt-0.5 text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                  {(llm.enabled ?? true)
                    ? `当前模型（${llm.provider} - ${llm.model || '默认'}）已开启，将参与 AI 翻译与分层调用`
                    : `当前模型（${llm.provider} - ${llm.model || '默认'}）已停用，系统将暂停该模型的调用`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLlmConfig({ enabled: !(llm.enabled ?? true) })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-3 ${
                  (llm.enabled ?? true)
                    ? 'bg-blue-600'
                    : isLight
                      ? 'bg-slate-300'
                      : 'bg-zinc-700'
                }`}
                title={(llm.enabled ?? true) ? '停用此模型' : '启用此模型'}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    (llm.enabled ?? true) ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>服务提供商</label>
                <select
                  value={llm.provider}
                  onChange={handleProviderChange}
                  className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none cursor-pointer ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                  }`}
                >
                  <option value="DeepSeek">DeepSeek (推荐·高性价比)</option>
                  <option value="OpenAI">OpenAI (GPT-4o / GPT-4o-mini)</option>
                  <option value="Ollama">Ollama (本地私有化大模型)</option>
                  <option value="智谱 GLM">智谱 GLM (GLM-4-Flash)</option>
                  <option value="Custom">自定义兼容接口 (Custom Endpoint)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    模型名称 (Model Identifier)
                  </label>
                  {fetchedModels.length > 0 && (
                    <span className="text-[10px] text-emerald-600 font-mono font-semibold">
                      ✓ 已拉取 {fetchedModels.length} 个模型
                    </span>
                  )}
                </div>

                {fetchedModels.length > 0 ? (
                  <div className="space-y-1.5">
                    <select
                      value={llm.model}
                      onChange={(e) => setLlmConfig({ model: e.target.value })}
                      className={`w-full rounded-xl border px-3.5 py-2 text-xs font-mono focus:border-blue-500 focus:outline-none cursor-pointer ${
                        isLight ? 'bg-white border-blue-300 text-blue-800 font-bold' : 'bg-zinc-950/90 border-blue-500/40 text-blue-300'
                      }`}
                    >
                      {fetchedModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={llm.model}
                      onChange={(e) => setLlmConfig({ model: e.target.value })}
                      placeholder="或手动输入 Model ID"
                      className={`w-full rounded-lg border px-3 py-1 text-[11px] focus:border-blue-500 focus:outline-none font-mono ${
                        isLight ? 'bg-slate-50 border-slate-300 text-slate-800' : 'bg-zinc-950/60 border-white/10 text-zinc-300'
                      }`}
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={llm.model}
                    onChange={(e) => setLlmConfig({ model: e.target.value })}
                    placeholder="如 deepseek-chat, gpt-4o-mini"
                    className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                      isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                    }`}
                  />
                )}
              </div>

              <div className="md:col-span-2">
                <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>API 接口地址 (Base URL)</label>
                <input
                  type="text"
                  value={llm.endpoint}
                  onChange={(e) => setLlmConfig({ endpoint: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                  }`}
                />
              </div>

              <div className="md:col-span-2">
                <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>API 密钥 (API Key)</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={llm.apiKey}
                    onChange={(e) => setLlmConfig({ apiKey: e.target.value })}
                    placeholder="sk-..."
                    className={`w-full rounded-xl border px-3.5 py-2 pr-10 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                      isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer ${
                      isLight ? 'text-slate-400 hover:text-slate-700' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

      {recordingTarget && typeof document !== 'undefined' && createPortal(
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setRecordingTarget(null); }}
          className="fixed inset-0 z-[600] flex items-center justify-center bg-black/65 backdrop-blur-md animate-in fade-in duration-150"
        >
          <div className="bg-slate-900 border-2 border-blue-500/80 rounded-2xl p-6 shadow-2xl max-w-md w-full text-center space-y-4 animate-in zoom-in-95 duration-150">
            <div className="h-12 w-12 rounded-full bg-blue-500/20 border border-blue-400 flex items-center justify-center mx-auto text-2xl animate-bounce">
              ⌨️
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">
                正在录制【
                {recordingTarget === 'capture'
                  ? '全局划词选区'
                  : recordingTarget === 'spotlight'
                  ? 'Spotlight 居中查词'
                  : recordingTarget === 'clipboard'
                  ? '剪贴板静默翻译'
                  : '唤醒 / 隐藏主程序'}
                】快捷键
              </h3>
              <p className="text-xs text-blue-300 leading-relaxed">
                请直接在键盘上按下您想设定的按键或组合键（如 <kbd className="bg-blue-900 px-1.5 py-0.5 rounded text-white font-mono font-bold">F1</kbd>、<kbd className="bg-blue-900 px-1.5 py-0.5 rounded text-white font-mono font-bold">Alt+Space</kbd> 或 <kbd className="bg-blue-900 px-1.5 py-0.5 rounded text-white font-mono font-bold">1</kbd>）
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setRecordingTarget(null)}
                className="px-5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold border border-rose-500/40 transition cursor-pointer"
              >
                取消录制 (Esc)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </>
  );
};
