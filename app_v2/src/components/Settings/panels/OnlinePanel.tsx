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
import { NetworkDiagCard } from './NetworkDiagCard';
import {
  cmdGetOcrEngineStatus, cmdFetchLlmModels, cmdOfflineStatus, cmdOfflineInstall,
  cmdOfflineUninstall, cmdGetAutoStart, cmdSetAutoStart, cmdUniversalTranslate,
} from '../../../services/tauri';
import { normalizeHotkeyForCompare } from '../../../services/hotkeys';
import type { OfflineEngineStatus } from '../../../services/tauri';
import { useLlmPanelState, PROVIDER_DEFAULT_ENDPOINTS } from './useLlmPanelState';
import type {
  LlmConfig, OcrEngineStatus, ThemeMode, FontFamilyOption, FontSizeOption, CustomDictItem,
} from '../../../services/types';

const isTestEnv = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
export const ONLINE_ENGINE_DEFS = [
  {
    id: 'google',
    name: 'Google 翻译 (官方通道)',
    tag: '快速稳定',
    tagColor: 'text-blue-300 bg-blue-500/15 border-blue-400/30',
    desc: '谷歌高质量公共多语言通道，响应迅速，支持全语种',
    region: 'foreign',
    note: '国外引擎：默认大陆网络通常无法直连，需代理或可访问 Google 的网络环境',
    icon: '🌐',
  },
  {
    id: 'bing',
    name: '微软 Bing 必应翻译',
    tag: '神经翻译',
    tagColor: 'text-sky-300 bg-sky-500/15 border-sky-400/30',
    desc: '微软神经网络智能翻译引擎，长短句自然流畅',
    region: 'foreign',
    note: '国外引擎：走 cn.bing.com 国内节点，一般可直接访问',
    icon: '🔷',
  },
  {
    id: 'youdao',
    name: '网易有道翻译',
    tag: '地道中英',
    tagColor: 'text-rose-300 bg-rose-500/15 border-rose-400/30',
    desc: '网易专业词典与智能翻译通道，中文与中英互译极度地道',
    region: 'domestic',
    note: '国内引擎：无需代理，直连可用',
    icon: '🔴',
  },
  {
    id: 'deepl',
    name: 'DeepL 极速翻译通道',
    tag: '德系精准',
    tagColor: 'text-teal-300 bg-teal-500/15 border-teal-400/30',
    desc: '欧洲顶级高语境翻译引擎，长难句与学术语境翻译首选',
    region: 'foreign',
    note: '国外引擎：默认大陆网络通常无法直连；首次使用需在下方填入 API Key 或自建 DeepLX 地址',
    icon: '⚡',
  },
  {
    id: 'myMemory',
    name: 'MyMemory 翻译记忆库',
    tag: '语料记忆库',
    tagColor: 'text-indigo-300 bg-indigo-500/15 border-indigo-400/30',
    desc: '全球大型翻译记忆库，汇聚数亿条人工翻译真实语料',
    region: 'foreign',
    note: '国外引擎：免费有频率限制（1 分钟约 20 次），需可访问其服务的网络环境',
    icon: '🧠',
  },
  {
    id: 'baidu',
    name: '百度通用翻译',
    tag: '中文优化',
    tagColor: 'text-blue-300 bg-blue-500/15 border-blue-400/30',
    desc: '百度中文语义增强翻译引擎，多语种覆盖全面',
    region: 'domestic',
    note: '国内引擎：无需代理；需在下方填入百度翻译 API 凭据（每月 100 万字符免费额度）',
    icon: '🐾',
  },
  {
    id: 'baiduLlm',
    name: '百度大模型翻译 (文心版)',
    tag: '大模型意译',
    tagColor: 'text-violet-300 bg-violet-500/15 border-violet-400/30',
    desc: '基于百度文心大语言模型内核，擅长长句深度意译、上下文感知与专业术语统一',
    region: 'domestic',
    note: '国内大模型：无需代理；与通用版共用相同 AppID/密钥（个人/企业享 100 万字符免费）',
    icon: '🧠',
  },
  {
    id: 'tencent',
    name: '腾讯交互翻译',
    tag: 'AI实验室',
    tagColor: 'text-cyan-300 bg-cyan-500/15 border-cyan-400/30',
    desc: '腾讯 AI 翻译实验室神经机器翻译，专业流畅',
    region: 'domestic',
    note: '国内引擎：无需代理，直连可用',
    icon: '🐧',
  },
  {
    id: 'lingva',
    name: 'Lingva Google 镜像',
    tag: '免翻镜像',
    tagColor: 'text-amber-300 bg-amber-500/15 border-amber-400/30',
    desc: '开源 Google 翻译镜像直连通道，国内免翻墙直接使用 Google 翻译能力',
    region: 'domestic',
    note: '免密镜像：国内直连，无需代理即可使用 Google 翻译核心能力',
    icon: '🕊️',
  },
  {
    id: 'caiyun',
    name: '彩云小译 (地道意译)',
    tag: '地道文学',
    tagColor: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30',
    desc: '国内文学与科技长句意译顶流，中文表达自然生动，机翻感极轻',
    region: 'domestic',
    note: '国内引擎：免密内置，国内网络直接高速访问',
    icon: '🌈',
  },
  {
    id: 'urban',
    name: 'Urban Dictionary (欧美网络俚语/流行梗)',
    tag: '欧美黑话',
    tagColor: 'text-purple-300 bg-purple-500/15 border-purple-400/30',
    desc: '全球最大网络黑话、流行梗与俚语缩写词库，专解 Reddit、Twitter、游戏最新热词',
    region: 'foreign',
    note: '免密开放通道：全球直连，专为欧美网络流行黑话与缩写词打造',
    icon: '🧢',
  },
  {
    id: 'volcengine',
    name: '字节跳动火山翻译',
    tag: '字节官方',
    tagColor: 'text-orange-300 bg-orange-500/15 border-orange-400/30',
    desc: '字节跳动抖音/TikTok 同款 NMT 机器翻译引擎，现代互联网科技与口语翻译极度地道',
    region: 'domestic',
    note: '国内官方通道：需在下方填入火山引擎 AccessKey / SecretKey',
    icon: '🌋',
  },
  {
    id: 'yandex',
    name: 'Yandex Translate',
    tag: '斯拉夫霸主',
    tagColor: 'text-red-300 bg-red-500/15 border-red-400/30',
    desc: '俄罗斯搜索巨头旗舰引擎，俄语、白俄、乌克兰及东欧斯拉夫语系翻译行业顶流',
    region: 'foreign',
    note: '国外官方通道：需在下方填入 Yandex Translate API Key',
    icon: '🇷🇺',
  },
] as const;

/** 在线翻译引擎开关与各家 API 配置 */
export const OnlinePanel: React.FC = () => {
  const { isLight } = useAppTheme();
  const {
    settings,
    setOnlineEngineToggle,
    setAllOnlineEngines,
    setBaiduConfig,
    setDeeplConfig,
    setVolcengineConfig,
    setYandexConfig,
  } = useSettingsStore();

  // LLM 模型池 UI 同时出现在本区与「快捷键与 AI 模型」区,共用一份状态逻辑
  const {
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

  const online = settings.onlineEngines || {
    google: true,
    bing: true,
    youdao: true,
    deepl: false,
    myMemory: false,
    baidu: false,
    baiduLlm: false,
    tencent: false,
  };

  const [baiduTesting, setBaiduTesting] = useState<'general' | 'llm' | null>(null);
  const [baiduTestResult, setBaiduTestResult] = useState<{ success: boolean; msg: string } | null>(null);

  const handleTestBaidu = async (engine: 'baidu' | 'baidu_llm') => {
    const appId = settings.baiduAppId?.trim();
    const secret = settings.baiduSecret?.trim();
    const llmApiKey = settings.baiduLlmApiKey?.trim();

    if (!appId) {
      setBaiduTestResult({ success: false, msg: '请先填写 AppID' });
      return;
    }
    if (engine === 'baidu' && !secret) {
      setBaiduTestResult({ success: false, msg: '请先填写通用版密钥（Secret Key）' });
      return;
    }
    if (engine === 'baidu_llm' && !llmApiKey) {
      setBaiduTestResult({ success: false, msg: '请先填写大模型版专用 API Key（在控制台「API Key 管理」中创建）' });
      return;
    }

    setBaiduTesting(engine === 'baidu' ? 'general' : 'llm');
    setBaiduTestResult(null);
    const t0 = performance.now();
    const testText = engine === 'baidu_llm' ? 'Artificial Intelligence' : 'apple';
    try {
      const res = await cmdUniversalTranslate({
        text: testText,
        sourceLang: 'en',
        targetLang: 'zh-CN',
        preset: 'auto',
        forcedEngine: engine,
        baiduAppId: appId,
        baiduSecret: secret,
        baiduLlmApiKey: llmApiKey,
        skipLlm: true,
      });
      const dur = Math.round(performance.now() - t0);
      const isLlm = engine === 'baidu_llm';
      const baiduEng = res.engines.find((e) =>
        isLlm
          ? e.engineName.includes('大模型') || e.engineName.includes('文心')
          : (e.engineName.includes('百度') || e.engineName.toLowerCase().includes('baidu')) && !e.engineName.includes('大模型'),
      ) || res.engines[0];

      if (baiduEng && !baiduEng.translated.startsWith('[') && !baiduEng.translated.includes('错误') && !baiduEng.translated.includes('未配置')) {
        const title = isLlm ? '🧠 文心大模型版' : '🐯 通用翻译版';
        setBaiduTestResult({
          success: true,
          msg: `${title} 连通成功！${testText} ➔ ${baiduEng.translated.trim()} (${dur}ms)`,
        });
      } else {
        setBaiduTestResult({
          success: false,
          msg: baiduEng ? baiduEng.translated : '未收到有效翻译返回',
        });
      }
    } catch (err: any) {
      setBaiduTestResult({
        success: false,
        msg: `连接失败: ${err?.message || String(err)}`,
      });
    } finally {
      setBaiduTesting(null);
    }
  };

  return (
    <>
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* 在线公共翻译服务通道网格矩阵 (紧凑高密度布局) */}
          <div className={`p-3.5 sm:p-4 space-y-2.5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className={`flex items-center space-x-1.5 text-xs sm:text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                  <Globe className="h-4 w-4 text-blue-500 shrink-0" />
                  <span className="truncate">在线公共翻译服务通道</span>
                  <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded border ${isLight ? 'bg-blue-50 text-blue-600 border-blue-200/60' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                    13 大主流引擎 · 免 Key 极速并发
                  </span>
                </div>
                <p className={`mt-0.5 text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                  支持多引擎免 Key 极速并发查询，开启的引擎将在双栏翻译与多源对照面板中呈现
                </p>
              </div>

              {/* 快捷批量操作按钮组：单行紧凑 */}
              <div className={`flex items-center space-x-1 self-start sm:self-auto p-0.5 rounded-lg border text-[11px] shrink-0 whitespace-nowrap ${
                isLight ? 'bg-slate-100/90 border-slate-200' : 'bg-zinc-950/80 border-white/[0.06]'
              }`}>
                <button
                  type="button"
                  onClick={() => setAllOnlineEngines('domestic')}
                  className="px-2 py-0.5 rounded text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition cursor-pointer font-medium whitespace-nowrap shrink-0"
                  title="仅启用国内免代理极速引擎（微软必应 + 网易有道 + 腾讯交互 + Lingva 镜像 + 彩云小译）"
                >
                  国内直连推荐
                </button>
                <button
                  type="button"
                  onClick={() => setAllOnlineEngines('all')}
                  className="px-2 py-0.5 rounded text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition cursor-pointer font-semibold whitespace-nowrap shrink-0"
                  title="启用全部在线引擎"
                >
                  开启全部
                </button>
                <button
                  type="button"
                  onClick={() => setAllOnlineEngines('none')}
                  className="px-2 py-0.5 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer whitespace-nowrap shrink-0"
                  title="关闭所有在线公共引擎"
                >
                  全部关闭
                </button>
              </div>
            </div>

            {/* 7 大在线引擎紧凑卡片网格 (单行流式高密度矩阵) */}
            <div className="space-y-2 pt-0.5">
              {/* 1. 国内免代理直连组 */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <span>🇨🇳 国内免代理直连 (极速响应)</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5 sm:gap-2">
                  {ONLINE_ENGINE_DEFS.filter((e) => e.region === 'domestic' || e.id === 'bing').map((eng) => {
                    const isEnabled = (online as Record<string, boolean | undefined>)[eng.id] ?? false;
                    return (
                      <div
                        key={eng.id}
                        title={(eng.desc + '\n\n' + (eng.note ?? '')).trim()}
                        className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 border transition-all duration-150 cursor-pointer select-none ${
                          isEnabled
                            ? (isLight ? 'bg-emerald-50/90 border-emerald-300 shadow-2xs' : 'bg-emerald-950/35 border-emerald-500/40')
                            : (isLight ? 'bg-slate-50/70 border-slate-200/80 opacity-65 hover:opacity-100 hover:bg-slate-100/80' : 'bg-zinc-950/30 border-white/[0.05] opacity-55 hover:opacity-100 hover:bg-zinc-900/50')
                        }`}
                        onClick={() => setOnlineEngineToggle(eng.id as keyof typeof online, !isEnabled)}
                      >
                        <div className="flex items-center space-x-1.5 min-w-0 pr-1.5">
                          <span className="text-xs shrink-0">{eng.icon}</span>
                          <span className={`text-[11.5px] font-semibold truncate ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                            {eng.name.replace(/（.*?）|\(.*?\)/g, '')}
                          </span>
                          <span className={`text-[8.5px] font-mono font-medium px-1 py-0 rounded border shrink-0 ${eng.tagColor}`}>
                            {eng.tag}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOnlineEngineToggle(eng.id as keyof typeof online, !isEnabled);
                          }}
                          className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                            isEnabled ? 'bg-emerald-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                          }`}
                        >
                          <span
                            className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
                              isEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. 国际 / 海外网络通道组 */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-bold text-violet-600 dark:text-violet-400">
                  <span>🌐 国际/海外通道 (需代理或海外网络)</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5 sm:gap-2">
                  {ONLINE_ENGINE_DEFS.filter((e) => e.region === 'foreign' && e.id !== 'bing').map((eng) => {
                    const isEnabled = (online as Record<string, boolean | undefined>)[eng.id] ?? false;
                    return (
                      <div
                        key={eng.id}
                        title={(eng.desc + '\n\n' + (eng.note ?? '')).trim()}
                        className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 border transition-all duration-150 cursor-pointer select-none ${
                          isEnabled
                            ? (isLight ? 'bg-violet-50/90 border-violet-300 shadow-2xs' : 'bg-violet-950/35 border-violet-500/40')
                            : (isLight ? 'bg-slate-50/70 border-slate-200/80 opacity-65 hover:opacity-100 hover:bg-slate-100/80' : 'bg-zinc-950/30 border-white/[0.05] opacity-55 hover:opacity-100 hover:bg-zinc-900/50')
                        }`}
                        onClick={() => setOnlineEngineToggle(eng.id as keyof typeof online, !isEnabled)}
                      >
                        <div className="flex items-center space-x-1.5 min-w-0 pr-1.5">
                          <span className="text-xs shrink-0">{eng.icon}</span>
                          <span className={`text-[11.5px] font-semibold truncate ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                            {eng.name.replace(/（.*?）|\(.*?\)/g, '')}
                          </span>
                          <span className={`text-[8.5px] font-mono font-medium px-1 py-0 rounded border shrink-0 ${eng.tagColor}`}>
                            {eng.tag}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOnlineEngineToggle(eng.id as keyof typeof online, !isEnabled);
                          }}
                          className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                            isEnabled ? 'bg-violet-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                          }`}
                        >
                          <span
                            className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
                              isEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 百度翻译 API 凭据配置（通用版或大模型版开启时显示）*/}
          {(online.baidu || online.baiduLlm) && (
            <div className={`p-4 space-y-3 rounded-2xl border transition-colors ${
              isLight ? 'bg-blue-50/60 border-blue-200/80' : 'bg-blue-950/20 border-blue-500/25'
            }`}>
              <div className={`flex items-center space-x-2 text-xs font-bold ${isLight ? 'text-blue-900' : 'text-blue-300'}`}>
                <span>🐾</span>
                <span>百度翻译开放平台 API 凭据</span>
                <span className={`text-[9px] font-normal px-1.5 py-0.5 rounded border ml-1 ${isLight ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}`}>
                  通用文本翻译 & 大模型文本翻译
                </span>
                <a href="https://fanyi-api.baidu.com/" target="_blank" rel="noreferrer"
                  className={`ml-auto text-[10px] underline underline-offset-2 ${isLight ? 'text-blue-600' : 'text-blue-400'}`}>
                  管理控制台 →
                </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className={!online.baidu && online.baiduLlm ? 'sm:col-span-1' : ''}>
                  <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>AppID（应用 ID）</label>
                  <input
                    type="text"
                    value={settings.baiduAppId || ''}
                    onChange={(e) => setBaiduConfig(e.target.value, settings.baiduSecret || '', settings.baiduLlmApiKey)}
                    placeholder="例如：20240001234567"
                    className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                      isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                    }`}
                  />
                </div>

                {online.baidu && (
                  <div>
                    <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>通用版密钥（Secret Key）</label>
                    <input
                      type="password"
                      value={settings.baiduSecret || ''}
                      onChange={(e) => setBaiduConfig(settings.baiduAppId || '', e.target.value, settings.baiduLlmApiKey)}
                      placeholder="开发者信息中的 32 位密钥"
                      className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                        isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                      }`}
                    />
                  </div>
                )}

                {online.baiduLlm && (
                  <div className={online.baidu ? 'sm:col-span-2' : ''}>
                    <div className="flex items-center justify-between mb-1">
                      <label className={`block text-[10px] font-medium ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                        大模型版专用 API Key（Bearer Token）
                      </label>
                      <span className={`text-[9.5px] ${isLight ? 'text-blue-600' : 'text-blue-400'}`}>
                        在「控制台 - API Key 管理」创建
                      </span>
                    </div>
                    <input
                      type="password"
                      value={settings.baiduLlmApiKey || ''}
                      onChange={(e) => setBaiduConfig(settings.baiduAppId || '', settings.baiduSecret || '', e.target.value)}
                      placeholder="百度开放平台「API Key 管理」中生成的专用密钥"
                      className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                        isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                      }`}
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-blue-200/40 dark:border-blue-500/20">
                <div className="flex items-center gap-2">
                  {online.baidu && (
                    <button
                      type="button"
                      onClick={() => handleTestBaidu('baidu')}
                      disabled={baiduTesting !== null || !settings.baiduAppId?.trim() || !settings.baiduSecret?.trim()}
                      className={`px-3 py-1 text-xs rounded-lg font-medium transition flex items-center gap-1.5 shrink-0 ${
                        baiduTesting !== null || !settings.baiduAppId?.trim() || !settings.baiduSecret?.trim()
                          ? 'opacity-50 cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-zinc-800 dark:text-zinc-500'
                          : isLight
                          ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:scale-95'
                          : 'bg-blue-500 hover:bg-blue-600 text-white shadow-sm active:scale-95'
                      }`}
                    >
                      {baiduTesting === 'general' ? '⏳ 测试中...' : '🐯 测试通用版'}
                    </button>
                  )}
                  {online.baiduLlm && (
                    <button
                      type="button"
                      onClick={() => handleTestBaidu('baidu_llm')}
                      disabled={
                        baiduTesting !== null ||
                        !settings.baiduAppId?.trim() ||
                        !settings.baiduLlmApiKey?.trim()
                      }
                      className={`px-3 py-1 text-xs rounded-lg font-medium transition flex items-center gap-1.5 shrink-0 ${
                        baiduTesting !== null ||
                        !settings.baiduAppId?.trim() ||
                        !settings.baiduLlmApiKey?.trim()
                          ? 'opacity-50 cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-zinc-800 dark:text-zinc-500'
                          : isLight
                          ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm active:scale-95'
                          : 'bg-violet-500 hover:bg-violet-600 text-white shadow-sm active:scale-95'
                      }`}
                    >
                      {baiduTesting === 'llm' ? '⏳ 测试中...' : '🧠 测试文心大模型'}
                    </button>
                  )}
                </div>
                {baiduTestResult && (
                  <span className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition animate-in fade-in max-w-full truncate ${
                    baiduTestResult.success
                      ? isLight ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                      : isLight ? 'bg-rose-100 text-rose-800' : 'bg-rose-950/60 text-rose-300 border border-rose-500/30'
                  }`}>
                    {baiduTestResult.msg}
                  </span>
                )}
              </div>
              <p className={`text-[10px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                前往 <a href="https://fanyi-api.baidu.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2">fanyi-api.baidu.com</a> 开通对应服务。注意：「通用翻译」使用开发者信息中的 32 位密钥，而「大模型文本翻译」需在控制台「API Key 管理」中单独创建专用 API Key。如需将文心千帆大模型作为 AI 精翻与会话引擎，可在下方 LLM 模型池中直接添加「百度文心 (千帆)」。
              </p>
            </div>
          )}

          {/* DeepL 官方 API / 自建 DeepLX 配置（仅当 DeepL 引擎开启时显示）*/}
          {online.deepl && (
            <div className={`p-4 space-y-3 rounded-2xl border transition-colors ${
              isLight ? 'bg-teal-50/60 border-teal-200/80' : 'bg-teal-950/20 border-teal-500/25'
            }`}>
              <div className={`flex items-center space-x-2 text-xs font-bold ${isLight ? 'text-teal-900' : 'text-teal-300'}`}>
                <span>⚡</span>
                <span>DeepL 翻译 API 配置</span>
                <span className={`text-[9px] font-normal px-1.5 py-0.5 rounded border ml-1 ${isLight ? 'bg-teal-100 text-teal-700 border-teal-200' : 'bg-teal-500/20 text-teal-400 border-teal-500/30'}`}>
                  免费 · 每月 50 万字符
                </span>
              </div>
              <div>
                <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                  官方免费 API Key
                  <a href="https://www.deepl.com/pro-api" target="_blank" rel="noreferrer"
                    className={`ml-2 underline underline-offset-2 ${isLight ? 'text-teal-600' : 'text-teal-400'}`}>
                    注册 →
                  </a>
                </label>
                <input
                  type="password"
                  value={settings.deeplApiKey || ''}
                  onChange={(e) => setDeeplConfig(e.target.value, settings.deeplCustomUrl || '')}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                  className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
                    isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                  }`}
                />
              </div>
              <div>
                <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                  自建 DeepLX 地址（可选，优先于官方 API）
                </label>
                <input
                  type="text"
                  value={settings.deeplCustomUrl || ''}
                  onChange={(e) => setDeeplConfig(settings.deeplApiKey || '', e.target.value)}
                  placeholder="http://localhost:1188/translate"
                  className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
                    isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                  }`}
                />
              </div>
              <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                填写官方 API Key 直连 DeepL 免费通道；或填写自建 DeepLX 地址（两者都填时优先使用自建地址）。
              </p>
            </div>
          )}

          {/* 火山翻译 (字节跳动) API 凭据配置（仅当火山引擎开启时显示）*/}
          {online.volcengine && (
            <div className={`p-4 space-y-3 rounded-2xl border transition-colors ${
              isLight ? 'bg-orange-50/60 border-orange-200/80' : 'bg-orange-950/20 border-orange-500/25'
            }`}>
              <div className={`flex items-center space-x-2 text-xs font-bold ${isLight ? 'text-orange-900' : 'text-orange-300'}`}>
                <span>🌋</span>
                <span>火山翻译 (字节跳动) API 配置</span>
                <span className={`text-[9px] font-normal px-1.5 py-0.5 rounded border ml-1 ${isLight ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-orange-500/20 text-orange-400 border-orange-500/30'}`}>
                  官方 OpenAPI 凭据
                </span>
                <a href="https://console.volcengine.com/translate" target="_blank" rel="noreferrer"
                  className={`ml-auto text-[10px] underline underline-offset-2 ${isLight ? 'text-orange-600' : 'text-orange-400'}`}>
                  前往火山引擎控制台 →
                </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>AccessKey ID（访问密钥 ID）</label>
                  <input
                    type="text"
                    value={settings.volcengineAccessKey || ''}
                    onChange={(e) => setVolcengineConfig(e.target.value, settings.volcengineSecretKey || '')}
                    placeholder="AKLTxxxxxxxxxxxxxxxx"
                    className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${
                      isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                    }`}
                  />
                </div>
                <div>
                  <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>Secret Access Key（访问密钥）</label>
                  <input
                    type="password"
                    value={settings.volcengineSecretKey || ''}
                    onChange={(e) => setVolcengineConfig(settings.volcengineAccessKey || '', e.target.value)}
                    placeholder="例如：TVdaWxxxxxxxxxxxxxxxx"
                    className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${
                      isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                    }`}
                  />
                </div>
              </div>
              <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                前往 <a href="https://console.volcengine.com/translate" target="_blank" rel="noreferrer" className="underline underline-offset-2">volcengine.com</a> 开通机器翻译服务并在访问控制获取 AccessKey / SecretKey。
              </p>
            </div>
          )}

          {/* Yandex Translate API 凭据配置（仅当 Yandex 引擎开启时显示）*/}
          {online.yandex && (
            <div className={`p-4 space-y-3 rounded-2xl border transition-colors ${
              isLight ? 'bg-red-50/60 border-red-200/80' : 'bg-red-950/20 border-red-500/25'
            }`}>
              <div className={`flex items-center space-x-2 text-xs font-bold ${isLight ? 'text-red-900' : 'text-red-300'}`}>
                <span>🇷🇺</span>
                <span>Yandex Translate API 配置</span>
                <span className={`text-[9px] font-normal px-1.5 py-0.5 rounded border ml-1 ${isLight ? 'bg-red-100 text-red-700 border-red-200' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                  官方 Cloud 凭据
                </span>
                <a href="https://cloud.yandex.com/services/translate" target="_blank" rel="noreferrer"
                  className={`ml-auto text-[10px] underline underline-offset-2 ${isLight ? 'text-red-600' : 'text-red-400'}`}>
                  Yandex.Cloud 注册 →
                </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>API Key（或 IAM Token）</label>
                  <input
                    type="password"
                    value={settings.yandexApiKey || ''}
                    onChange={(e) => setYandexConfig(e.target.value, settings.yandexFolderId || '')}
                    placeholder="AQVNxxxxxxxxxxxxxxxx"
                    className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-red-500/40 ${
                      isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                    }`}
                  />
                </div>
                <div>
                  <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>Folder ID（可选，Yandex.Cloud 目录 ID）</label>
                  <input
                    type="text"
                    value={settings.yandexFolderId || ''}
                    onChange={(e) => setYandexConfig(settings.yandexApiKey || '', e.target.value)}
                    placeholder="b1gxxxxxxxxxxxxxxxx"
                    className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-red-500/40 ${
                      isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                    }`}
                  />
                </div>
              </div>
              <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                前往 <a href="https://cloud.yandex.com/services/translate" target="_blank" rel="noreferrer" className="underline underline-offset-2">cloud.yandex.com</a> 创建服务账号并生成 API 密钥。
              </p>
            </div>
          )}

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
                  <option value="百度文心 (千帆)">百度文心千帆 (ERNIE-Speed / ERNIE-4.0)</option>
                  <option value="SiliconFlow">SiliconFlow (硅基流动)</option>
                  <option value="智谱 GLM">智谱 GLM (GLM-4-Flash)</option>
                  <option value="通义千问">通义千问 (Qwen-Plus)</option>
                  <option value="Kimi">Moonshot Kimi</option>
                  <option value="OpenAI">OpenAI (GPT-4o / GPT-4o-mini)</option>
                  <option value="Ollama">Ollama (本地私有化大模型)</option>
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

        {/* 网络诊断：区分网络问题与配置问题 */}
        <NetworkDiagCard />
    </>
  );
};
