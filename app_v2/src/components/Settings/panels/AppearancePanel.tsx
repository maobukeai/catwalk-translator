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
import type { AppearanceSettings } from '../../../services/types';

const DEFAULT_APPEARANCE_FALLBACK: AppearanceSettings = {
  theme: 'system',
  enableBlur: true,
  blurAmount: 24,
  enableTransparency: true,
  windowOpacity: 85,
  fontFamily: 'system',
  fontSize: 'medium',
};

/** 外观与个性化：主题、磨砂玻璃、透明度、字体 */
export const AppearancePanel: React.FC = () => {
  const { isLight } = useAppTheme();
  const {
    settings,
    setAppearance,
    setThemeMode,
    setEnableBlur,
    setBlurAmount,
    setEnableTransparency,
    setWindowOpacity,
    setFontFamilyOption,
    setFontSizeOption,
  } = useSettingsStore();

  const appearance = settings.appearance || DEFAULT_APPEARANCE_FALLBACK;
  void setAppearance;
  const activeTheme = appearance.theme || 'system';

  return (
    <>
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className={`p-5 space-y-5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div>
              <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                <Palette className="h-4 w-4 text-purple-400" />
                <span>外观与个性化</span>
              </div>
              <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                自定义界面视觉主题、高斯模糊透明度、全局字体及字号缩放
              </p>
            </div>

            {/* 1. Live Preview Card 实时效果预览 (紧凑型设计，减少垂直占用) */}
            <div className={`relative overflow-hidden rounded-xl border p-3 space-y-2.5 shadow-xs transition-all ${
              isLight ? 'border-slate-300/80 bg-white/45 backdrop-blur-md' : 'border-white/10 bg-zinc-950/80'
            }`}>
              <div className={`flex flex-wrap items-center justify-between gap-1.5 border-b pb-2 relative z-10 ${
                isLight ? 'border-slate-200' : 'border-white/[0.08]'
              }`}>
                <div className={`flex items-center space-x-1.5 text-xs font-bold ${
                  isLight ? 'text-slate-800' : 'text-zinc-200'
                }`}>
                  <Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <span>效果预览</span>
                </div>
                
                {/* 状态徽章 (紧凑高对比度) */}
                <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono">
                  <span className={`px-2 py-0.5 rounded-full font-semibold border shadow-xs ${
                    isLight ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-blue-500/20 text-blue-300 border-blue-400/30'
                  }`}>
                    主题: {appearance.theme === 'dark' || appearance.theme === ('fluent-dark' as any) ? '深色' : appearance.theme === 'light' ? '浅色' : '跟随系统'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold border shadow-xs ${
                    isLight ? 'bg-purple-100 text-purple-800 border-purple-300' : 'bg-purple-500/20 text-purple-300 border-purple-400/30'
                  }`}>
                    字体: {appearance.fontFamily === 'yahei' ? '微软雅黑' : appearance.fontFamily === 'segoe' ? 'Segoe UI' : appearance.fontFamily === 'inter' ? 'Inter' : appearance.fontFamily === 'mono' ? 'JetBrains Mono' : '系统默认'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold border shadow-xs ${
                    isLight ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                  }`}>
                    字号: {appearance.fontSize === 'small' ? '13px' : appearance.fontSize === 'medium' ? '14px' : appearance.fontSize === 'large' ? '16px' : '18px'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold border shadow-xs ${
                    isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-400/30'
                  }`}>
                    磨砂: {(appearance.enableBlur ?? true) ? `${appearance.blurAmount ?? 24}px` : '禁用'}
                  </span>
                </div>
              </div>

              {/* 紧凑模拟舞台 */}
              <div className="relative rounded-lg overflow-hidden h-16 sm:h-20 min-h-0 flex items-center justify-center p-2 border border-slate-300/60 dark:border-white/10">
                {/* 底层：高对比度生动测试极光图谱 */}
                <div
                  aria-hidden
                  className="absolute inset-0 pointer-events-none overflow-hidden select-none"
                  style={{
                    filter: (appearance.enableBlur ?? true) ? `blur(${((appearance.blurAmount ?? 24) * 0.85).toFixed(1)}px)` : 'none',
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{
                      backgroundImage: isLight
                        ? 'radial-gradient(#3b82f6 1.5px, transparent 1.5px), radial-gradient(#ec4899 1px, transparent 1px)'
                        : 'radial-gradient(#60a5fa 1.5px, transparent 1.5px), radial-gradient(#f43f5e 1px, transparent 1px)',
                      backgroundSize: '16px 16px',
                    }}
                  />
                  <div
                    className="absolute -top-8 -left-6 w-48 h-32 rounded-3xl opacity-85 transform -rotate-12"
                    style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #8b5cf6 100%)' }}
                  />
                  <div
                    className="absolute top-0 left-1/3 w-40 h-24 rounded-full opacity-80 transform rotate-45"
                    style={{ background: 'linear-gradient(120deg, #ec4899 0%, #f43f5e 50%, #fb923c 100%)' }}
                  />
                  <div
                    className="absolute -bottom-6 -right-6 w-48 h-32 rounded-3xl opacity-80 transform rotate-12"
                    style={{ background: 'linear-gradient(145deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%)' }}
                  />
                </div>

                {/* 顶层：划词与对译磨砂玻璃悬浮卡片 (紧凑单行/双行横向) */}
                <div
                  className={`relative z-10 w-full max-w-xl overflow-hidden rounded-lg px-3 py-1.5 sm:py-2 border flex items-center justify-between gap-3 shadow-md ${
                    isLight
                      ? 'text-slate-900 border-white/80 shadow-slate-900/10'
                      : 'text-zinc-100 border-white/20 shadow-black/40'
                  }`}
                  style={{
                    backgroundColor: isLight
                      ? (appearance.enableBlur ?? true)
                        ? `rgba(255, 255, 255, ${(0.28 + ((appearance.blurAmount ?? 24) / 40) * 0.36).toFixed(3)})`
                        : 'rgba(255, 255, 255, 0.92)'
                      : (appearance.enableBlur ?? true)
                        ? `rgba(15, 18, 26, ${(0.30 + ((appearance.blurAmount ?? 24) / 40) * 0.36).toFixed(3)})`
                        : 'rgba(15, 18, 26, 0.94)',
                    backdropFilter: (appearance.enableBlur ?? true) ? `blur(${appearance.blurAmount ?? 24}px) saturate(160%)` : 'none',
                    WebkitBackdropFilter: (appearance.enableBlur ?? true) ? `blur(${appearance.blurAmount ?? 24}px) saturate(160%)` : 'none',
                    fontFamily:
                      appearance.fontFamily === 'yahei'
                        ? '"Microsoft YaHei", sans-serif'
                        : appearance.fontFamily === 'segoe'
                        ? '"Segoe UI", sans-serif'
                        : appearance.fontFamily === 'inter'
                        ? '"Inter", sans-serif'
                        : appearance.fontFamily === 'mono'
                        ? '"JetBrains Mono", monospace'
                        : 'system-ui, sans-serif',
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm shrink-0">🐱</span>
                    <div className="min-w-0">
                      <div className={`font-mono text-[11px] opacity-75 truncate leading-tight ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
                        Principled BSDF
                      </div>
                      <div className={`font-bold tracking-tight truncate leading-snug ${
                        isLight ? 'text-slate-950' : 'text-white'
                      } ${
                        appearance.fontSize === 'small' ? 'text-xs' : appearance.fontSize === 'medium' ? 'text-sm' : appearance.fontSize === 'large' ? 'text-base' : 'text-base font-extrabold'
                      }`}>
                        原理化 BSDF 材质节点
                      </div>
                    </div>
                  </div>

                  <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border shadow-xs shrink-0 whitespace-nowrap hidden sm:inline-flex ${
                    isLight ? 'bg-blue-50/90 text-blue-700 border-blue-200' : 'bg-blue-500/20 text-blue-300 border-blue-400/30'
                  }`}>
                    🧊 Blender CG 专属词库
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Theme Selector (3 Tiles) */}
            <div className="space-y-2">
              <label className={`block text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>视觉主题模式</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {[
                  { id: 'system', name: '跟随系统', sub: 'System', icon: Monitor, desc: '自动同步 OS 模式' },
                  { id: 'light', name: '明亮浅色', sub: 'Light', icon: Sun, desc: '清爽通透苹果浅色' },
                  { id: 'dark', name: '经典深色', sub: 'Dark', icon: Moon, desc: '高级深邃苹果暗黑' },
                ].map((item) => {
                  const isSelected = (appearance.theme === item.id) || (item.id === 'dark' && appearance.theme === ('fluent-dark' as any));
                  const ItemIcon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setThemeMode(item.id as ThemeMode)}
                      className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? (isLight
                              ? 'bg-blue-50/90 border-2 border-blue-600 shadow-md shadow-blue-500/10'
                              : 'bg-blue-600/20 border-blue-500 text-white shadow-md ring-1 ring-blue-500/50')
                          : (isLight
                              ? 'bg-white/70 border border-slate-200/90 text-slate-800 hover:bg-white/90 hover:border-slate-300'
                              : 'bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08] hover:border-zinc-700')
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <ItemIcon className={`h-4 w-4 ${isSelected ? (isLight ? 'text-blue-600' : 'text-blue-400') : (isLight ? 'text-slate-500' : 'text-zinc-400')}`} />
                        {isSelected && <CheckCircle2 className={`h-3.5 w-3.5 ${isLight ? 'text-blue-600' : 'text-blue-400'}`} />}
                      </div>
                      <div className={`mt-2 text-xs font-bold ${isLight ? (isSelected ? 'text-blue-950 font-extrabold' : 'text-slate-900') : 'text-white'}`}>{item.name}</div>
                      <div className={`text-[10px] mt-0.5 ${isLight ? (isSelected ? 'text-blue-900/90 font-semibold' : 'text-slate-600 font-medium') : 'text-zinc-400'}`}>{item.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Frosted Glass Blur Intensity Control */}
            <div className={`space-y-3 pt-3 border-t ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>开启背景磨砂玻璃材质</div>
                  <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-600 font-medium' : 'text-zinc-400'}`}>
                    启用或禁用软件主界面与控制面板的高斯模糊磨砂效果
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={appearance.enableBlur ?? true}
                    onChange={(e) => setEnableBlur(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {(appearance.enableBlur ?? true) && (
                <div className={`space-y-2 p-3.5 rounded-xl border ${
                  isLight ? 'bg-slate-100/90 border-slate-200 text-slate-900' : 'bg-zinc-950/60 border-white/[0.06] text-zinc-300'
                }`}>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold">磨砂模糊程度调节 (Frosted Glass Blur)</span>
                    <span className="font-mono text-blue-600 font-bold">
                      {appearance.blurAmount ?? 24}px ({appearance.blurAmount === 0 ? '无模糊' : appearance.blurAmount! > 30 ? '重度磨砂' : '标准磨砂'})
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={appearance.blurAmount ?? 24}
                    onChange={(e) => setBlurAmount(Number(e.target.value))}
                    className="w-full h-1.5 bg-zinc-300 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className={`flex justify-between text-[10px] pt-0.5 ${isLight ? 'text-slate-600 font-medium' : 'text-zinc-400'}`}>
                    <span>0px (清晰透视)</span>
                    <span>24px (默认磨砂)</span>
                    <span>40px (重度模糊)</span>
                  </div>
                </div>
              )}
            </div>

            {/* 4. Font Family Selector */}
            <div className={`space-y-2 pt-3 border-t ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <label className={`block text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>字体样式 (Font Family)</label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { id: 'system', name: '系统默认', sub: 'System UI', fontStyle: "'Segoe UI Variable Text', system-ui, -apple-system, Segoe UI, Roboto, 'Microsoft YaHei UI', 'PingFang SC', sans-serif" },
                  { id: 'yahei', name: '微软雅黑', sub: 'Microsoft YaHei', fontStyle: "'Microsoft YaHei UI', 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif" },
                  { id: 'segoe', name: 'Segoe UI', sub: 'Segoe UI', fontStyle: "'Segoe UI Variable Text', 'Segoe UI', -apple-system, sans-serif" },
                  { id: 'inter', name: 'Inter', sub: '现代无衬线', fontStyle: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
                  { id: 'mono', name: '等宽字体', sub: 'JetBrains Mono', fontStyle: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', ui-monospace, Consolas, Monaco, monospace" },
                ].map((f) => {
                  const isSelected = appearance.fontFamily === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFontFamilyOption(f.id as FontFamilyOption)}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        isSelected
                          ? (isLight
                              ? 'bg-blue-50/90 border-2 border-blue-600 text-blue-950 shadow-md shadow-blue-500/10'
                              : 'bg-blue-600/20 border-blue-500 text-white ring-1 ring-blue-500/40 shadow-sm')
                          : (isLight
                              ? 'bg-slate-100/90 border border-slate-200 text-slate-800 hover:bg-slate-200/80 hover:border-slate-300'
                              : 'bg-zinc-950/50 border-white/[0.06] text-zinc-300 hover:bg-zinc-900 hover:border-zinc-700')
                      }`}
                    >
                      <div className={`text-xs font-bold truncate ${isLight ? (isSelected ? 'text-blue-950 font-extrabold' : 'text-slate-900') : 'text-white'}`} style={{ fontFamily: f.fontStyle }}>
                        {f.name}
                      </div>
                      <div className={`text-[10px] mt-0.5 truncate ${isLight ? (isSelected ? 'text-blue-900/90 font-semibold' : 'text-slate-600 font-medium') : 'text-zinc-400'}`}>{f.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 5. Font Size Selector */}
            <div className={`space-y-2 pt-3 border-t ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <label className={`block text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>字号大小 (Font Size)</label>
              <div className={`flex items-center space-x-1.5 p-1.5 rounded-xl border ${
                isLight ? 'bg-slate-200/80 border-slate-300/80' : 'bg-zinc-950/80 border-white/[0.08]'
              }`}>
                {[
                  { id: 'small', label: '小 (13px)' },
                  { id: 'medium', label: '标准 (14px)' },
                  { id: 'large', label: '大 (16px)' },
                  { id: 'xlarge', label: '超大 (18px)' },
                ].map((s) => {
                  const isSelected = appearance.fontSize === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setFontSizeOption(s.id as FontSizeOption)}
                      className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm border border-blue-400/40 font-bold'
                          : (isLight ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/60' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]')
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
    </>
  );
};
