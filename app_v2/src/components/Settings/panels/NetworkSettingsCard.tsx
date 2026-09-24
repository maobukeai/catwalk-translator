import React from 'react';
import { Globe, ShieldCheck, RefreshCw, Server } from 'lucide-react';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { GlassSelect, type GlassSelectOption } from '../../Common/GlassSelect';
import type { ProxyMode, RetryPreset } from '../../../services/types';

export const PROXY_MODE_OPTIONS: GlassSelectOption[] = [
  {
    value: 'system',
    label: '跟随系统',
    sub: '自动读取系统代理并探测端口存活，幽灵代理自动降级',
  },
  {
    value: 'direct',
    label: '不使用代理',
    sub: '强制全局直连，忽略系统注册表与环境变量代理',
  },
  {
    value: 'manual',
    label: '手动代理',
    sub: '指定自定义 HTTP / HTTPS / SOCKS5 代理服务器',
  },
];

export const RETRY_PRESET_OPTIONS: GlassSelectOption[] = [
  {
    value: 'balanced',
    label: '标准均衡 (推荐)',
    sub: '最多重试 2 次 · 500ms 指数退避重连',
  },
  {
    value: 'fast',
    label: '快速重试',
    sub: '最多重试 1 次 · 300ms 低延迟极速重连',
  },
  {
    value: 'resilient',
    label: '强力抗抖动',
    sub: '最多重试 3 次 · 800ms 指数退避 + 超时放宽 1.5x',
  },
  {
    value: 'none',
    label: '不重试',
    sub: '0 次重试 · 遇错立即切换下一层级或返回',
  },
];

const QUICK_PROXY_PRESETS = [
  { label: 'Clash (7890)', url: 'http://127.0.0.1:7890' },
  { label: 'v2rayN (10809)', url: 'http://127.0.0.1:10809' },
  { label: 'SOCKS5 (1080)', url: 'socks5://127.0.0.1:1080' },
];

export const NetworkSettingsCard: React.FC = () => {
  const { isLight } = useAppTheme();
  const {
    settings,
    setProxyMode,
    setProxyUrl,
    setProxyBypassDomestic,
    setRetryPreset,
  } = useSettingsStore();

  const effectiveProxyMode: ProxyMode =
    settings.proxyMode === 'direct' || settings.proxyMode === 'manual' || settings.proxyMode === 'system'
      ? settings.proxyMode
      : settings.proxyEnabled
      ? 'manual'
      : 'system';

  const effectiveRetryPreset: RetryPreset = settings.retryPreset || 'balanced';
  const bypassDomestic = settings.proxyBypassDomestic ?? true;

  return (
    <div
      className={`rounded-2xl border p-4 space-y-4 transition-colors ${
        isLight
          ? 'bg-white/75 border-slate-200 text-slate-800 shadow-xs'
          : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
      }`}
      data-testid="network-settings-card"
    >
      {/* 顶部标题：网络 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-blue-500 shrink-0" />
          <span className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
            网络
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              isLight
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
            }`}
          >
            代理分流与抗抖动
          </span>
        </div>
        <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
          统一管控在线翻译、大模型 API、词典源与更新通道
        </span>
      </div>

      {/* 一、代理设置 */}
      <div className="space-y-2">
        <div className={`text-xs font-bold ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
          代理设置
        </div>

        <div
          className={`rounded-xl border p-3 space-y-3 ${
            isLight
              ? 'bg-slate-50/90 border-slate-200/90'
              : 'bg-zinc-950/60 border-white/[0.06]'
          }`}
        >
          {/* 代理模式下拉 */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={`text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                代理模式
              </div>
              <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                {effectiveProxyMode === 'system' &&
                  '自动跟随 Windows 系统代理；若代理软件已退出则自动切换直连'}
                {effectiveProxyMode === 'direct' &&
                  '强制全局直连，不经过任何系统代理或环境变量代理（挂梯子导致翻译异常时推荐）'}
                {effectiveProxyMode === 'manual' &&
                  '使用下方指定的 HTTP / SOCKS5 代理服务器转发境外请求'}
              </div>
            </div>

            <div className="shrink-0" data-testid="proxy-mode-select">
              <GlassSelect
                title="代理模式"
                value={effectiveProxyMode}
                options={PROXY_MODE_OPTIONS}
                onChange={(val) => setProxyMode(val as ProxyMode)}
                align="right"
                size="md"
              />
            </div>
          </div>

          {/* 手动代理地址输入框与快捷端口 */}
          {effectiveProxyMode === 'manual' && (
            <div
              className={`pt-2.5 border-t space-y-2 ${
                isLight ? 'border-slate-200/80' : 'border-white/[0.06]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className={`text-[11px] font-medium flex items-center gap-1 ${
                  isLight ? 'text-slate-600' : 'text-zinc-400'
                }`}>
                  <Server className="h-3 w-3 text-blue-500" />
                  代理服务器地址
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {QUICK_PROXY_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setProxyUrl(preset.url)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono border transition cursor-pointer ${
                        (settings.proxyUrl || '') === preset.url
                          ? isLight
                            ? 'bg-blue-100 border-blue-300 text-blue-700 font-bold'
                            : 'bg-blue-500/20 border-blue-400/40 text-blue-300 font-bold'
                          : isLight
                          ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                          : 'bg-white/[0.04] border-white/10 text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

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
            </div>
          )}

          {/* 国内服务直连绕过代理开关 */}
          {effectiveProxyMode !== 'direct' && (
            <div
              className={`pt-2.5 border-t flex items-center justify-between gap-3 ${
                isLight ? 'border-slate-200/80' : 'border-white/[0.06]'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span className={`text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    国内服务直连绕过代理 (智能分流)
                  </span>
                </div>
                <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                  百度、有道、腾讯、彩云、DeepSeek、硅基流动、千问、智谱等国内节点强制直连，避免绕行境外代理导致超时
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={bypassDomestic}
                  onChange={(e) => setProxyBypassDomestic(e.target.checked)}
                  className="sr-only peer"
                  data-testid="proxy-bypass-domestic-toggle"
                />
                <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* 二、重试策略 */}
      <div className="space-y-2">
        <div className={`text-xs font-bold ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
          重试策略
        </div>

        <div
          className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${
            isLight
              ? 'bg-slate-50/90 border-slate-200/90'
              : 'bg-zinc-950/60 border-white/[0.06]'
          }`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
              <span className={`text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                重试预设
              </span>
            </div>
            <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
              {effectiveRetryPreset === 'balanced' &&
                '遇到网络瞬断、连接重置或 429/502/503 时自动重试最多 2 次（500ms → 1000ms 指数退避）'}
              {effectiveRetryPreset === 'fast' &&
                '低延迟优先：遇到瞬时丢包仅快速重试 1 次（300ms），适合高频截图与取词'}
              {effectiveRetryPreset === 'resilient' &&
                '弱网/跨境代理增强：最多重试 3 次（800ms 指数退避）并将连接与读取超时放宽 1.5 倍'}
              {effectiveRetryPreset === 'none' &&
                '不进行单通道重试：一旦报错或超时立即失败并切换至下一备选翻译层级'}
            </div>
          </div>

          <div className="shrink-0" data-testid="retry-preset-select">
            <GlassSelect
              title="重试预设"
              value={effectiveRetryPreset}
              options={RETRY_PRESET_OPTIONS}
              onChange={(val) => setRetryPreset(val as RetryPreset)}
              align="right"
              size="md"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
