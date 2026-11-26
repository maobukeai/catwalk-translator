import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  ExternalLink,
  Check,
  RefreshCw,
  MessageCircle,
  Heart,
  X,
  Layers,
  Cpu,
  Database,
  Globe2,
  Boxes,
  Zap,
  BookOpen,
  Bot,
  Settings,
  ShieldCheck,
  Download,
  AlertCircle,
} from "lucide-react";
import { useAppTheme } from "../../hooks/useAppTheme";
import {
  cmdCheckAppUpdate,
  cmdGetAppInfo,
  cmdOpenExternalUrl,
  cmdDownloadAndInstallUpdate,
  cmdOfflineModelsStatus,
  onUpdateDownloadProgress,
  type AppInfo,
  type UpdateCheckResult,
} from "../../services/tauri";
import { hasAnyCompleteModelSet } from "../OcrModelGuideModal";
import type { UpdateDownloadProgress } from "../../services/types";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useSlidingIndicator } from "../../hooks/useSlidingIndicator";
import { SlidingHighlight } from "../Common/SlidingHighlight";
import appIcon from "../../assets/app_icon_v2.png";
import { APP_VERSION } from "../../version";
import contactQr from "../../assets/contact_qr.webp";
import sponsorQr from "../../assets/sponsor_qr.webp";

interface AboutPanelProps {
  onOpenSettings?: () => void;
}

interface EngineCompatibility {
  name: string;
  badge: string;
  badgeType: "verified" | "offline" | "ai" | "free" | "experimental";
  category: "offline" | "online" | "ai";
  description: string;
  icon: React.ElementType;
}

const ENGINE_FILTER_TABS = [
  { id: "all", label: "全部" },
  { id: "offline", label: "离线" },
  { id: "online", label: "在线" },
  { id: "ai", label: "大模型" },
] as const;

const ENGINE_COMPATIBILITY_LIST: EngineCompatibility[] = [
  {
    name: "本地离线 OCR",
    badge: "离线可用",
    badgeType: "offline",
    category: "offline",
    description: "内置轻量 ONNX 硬件级加速引擎，毫秒级精准文字识别，无网络依赖",
    icon: Zap,
  },
  {
    name: "CG 离线专业词库",
    badge: "离线可用",
    badgeType: "offline",
    category: "offline",
    description: "涵盖 Blender / Unreal / Unity / Maya 等 3D 材质节点与图形学释义",
    icon: BookOpen,
  },
  {
    name: "微软 Bing 翻译",
    badge: "已验证",
    badgeType: "verified",
    category: "online",
    description: "国内直连免密高速通道，超低延迟即时翻译，支持 30+ 语种",
    icon: Globe2,
  },
  {
    name: "Google 翻译",
    badge: "已验证",
    badgeType: "verified",
    category: "online",
    description: "全球主流语种多引擎互译，覆盖 30+ 种世界语言",
    icon: Globe2,
  },
  {
    name: "DeepL 极速通道",
    badge: "已验证",
    badgeType: "verified",
    category: "online",
    description: "权威高质量自然语言互译，支持官方 API 与自定义自建 DeepLX",
    icon: Boxes,
  },
  {
    name: "AI 深度翻译 (LLM)",
    badge: "大模型",
    badgeType: "ai",
    category: "ai",
    description: "支持 DeepSeek / Gemini / OpenAI / 本地 Ollama 语义与上下文深度翻译",
    icon: Bot,
  },
  {
    name: "百度通用翻译",
    badge: "已验证",
    badgeType: "verified",
    category: "online",
    description: "支持百度官方开放平台 API 密钥接入，稳定可靠",
    icon: ShieldCheck,
  },
  {
    name: "MyMemory 翻译",
    badge: "免配置",
    badgeType: "free",
    category: "online",
    description: "全球开放翻译记忆库，开箱即用无需配置密钥",
    icon: Layers,
  },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let unitIndex = 0;
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024;
    unitIndex++;
  }
  return `${val.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export const AboutPanel: React.FC<AboutPanelProps> = ({ onOpenSettings }) => {
  const { isLight } = useAppTheme();
  const { settings, setAutoCheckUpdate, setAutoSilentUpdate } = useSettingsStore();
  const [qrModal, setQrModal] = useState<"contact" | "sponsor" | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null);
  const [ocrModelReady, setOcrModelReady] = useState<boolean | null>(null);
  const [matrixFilter, setMatrixFilter] = useState<"all" | "offline" | "online" | "ai">("all");
  const matrixSlider = useSlidingIndicator<HTMLDivElement>(matrixFilter, [isLight]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onUpdateDownloadProgress((p) => {
      setDownloadProgress(p);
      if (p.stage === "installing") {
        setDownloadStatus("下载完成，正在自动覆盖升级并重启...");
      } else if (p.stage.startsWith("error:")) {
        setDownloadStatus(null);
        setIsDownloadingUpdate(false);
      }
    }).then((u) => {
      unlisten = u;
    }).catch(() => {});
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    cmdGetAppInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info);
      })
      .catch(() => {});
    cmdOfflineModelsStatus()
      .then((models) => {
        if (!cancelled) setOcrModelReady(hasAnyCompleteModelSet(models));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const openLink = (url: string) => {
    void cmdOpenExternalUrl(url);
  };

  const handleInAppUpdate = async () => {
    if (!updateResult?.latest) return;
    const assets = updateResult.latest.assets || [];
    // 优先选择 Windows 安装包 (.exe)
    const setupAsset =
      assets.find((a) => a.name.toLowerCase().endsWith("-setup.exe") || a.name.toLowerCase().endsWith(".exe")) ||
      assets[0];

    const targetUrl = setupAsset?.url || updateResult.latest.download_url;
    if (!targetUrl || !targetUrl.startsWith("http")) {
      openLink(updateResult.latest.download_url);
      return;
    }

    setIsDownloadingUpdate(true);
    setDownloadStatus("正在下载新版本安装包...");
    setDownloadProgress({
      percentage: 0,
      downloadedBytes: 0,
      totalBytes: setupAsset?.size || 0,
      speedBytesPerSec: 0,
      stage: "downloading",
    });

    const isSilent = useSettingsStore.getState().settings.autoSilentUpdate ?? false;
    try {
      await cmdDownloadAndInstallUpdate(targetUrl, isSilent);
      setDownloadStatus(isSilent ? "正在全自动静默安装并重启..." : "安装程序已启动，正在关闭当前应用进行升级...");
    } catch (err) {
      setDownloadStatus(null);
      alert(`软件内自动下载失败: ${err}\n已为您打开浏览器下载页面。`);
      openLink(updateResult.latest.download_url);
    } finally {
      setIsDownloadingUpdate(false);
    }
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const result = await cmdCheckAppUpdate();
      setUpdateResult(result);
      if (result.has_update && result.latest) {
        window.dispatchEvent(new CustomEvent('open-update-modal', { detail: result.latest }));
      }
    } catch (err) {
      setUpdateResult({
        latest: null,
        has_update: false,
        current_version: appInfo?.version || APP_VERSION,
        error: String(err),
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const getBadgeStyle = (type: EngineCompatibility["badgeType"]) => {
    switch (type) {
      case "verified":
      case "offline":
        return isLight
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      case "ai":
        return isLight
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-blue-500/10 text-blue-400 border-blue-500/30";
      case "free":
        return isLight
          ? "bg-amber-50 text-amber-700 border-amber-200"
          : "bg-amber-500/10 text-amber-400 border-amber-500/30";
      default:
        return isLight
          ? "bg-slate-100 text-slate-700 border-slate-200"
          : "bg-zinc-800 text-zinc-300 border-zinc-700";
    }
  };

  const currentVer = appInfo?.version || APP_VERSION;
  const filteredEngines =
    matrixFilter === "all"
      ? ENGINE_COMPATIBILITY_LIST
      : ENGINE_COMPATIBILITY_LIST.filter((e) => e.category === matrixFilter);

  return (
    <div className="flex flex-col h-full min-h-0 space-y-4 select-text pb-6">
      {/* 弹窗：微信二维码 / 赞赏码（统一 Mac 灵动 Sheet 风格） */}
      {qrModal && typeof document !== "undefined" && createPortal(
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setQrModal(null); }}
          className="vision-modal-backdrop fixed inset-0 z-[500] flex items-center justify-center p-4 transition-colors animate-in fade-in duration-150"
        >
          <div
            className={`vision-modal-shell vision-modal-enter relative w-full max-w-sm rounded-[26px] p-6 overflow-hidden ${
              isLight ? "text-slate-800" : "text-zinc-100"
            }`}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={() => setQrModal(null)}
              className={`absolute top-4 right-4 p-1.5 rounded-full transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                isLight
                  ? "text-slate-400 hover:text-slate-700 hover:bg-slate-200/70"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-white/10"
              }`}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex flex-col items-center text-center space-y-4">
              <h3 className="text-sm font-bold text-[var(--g-text-1)]">
                {qrModal === "contact" ? "联系作者 · 微信二维码" : "赞助支持 · 赞赏码"}
              </h3>

              <div className="p-2.5 rounded-2xl border bg-white dark:bg-white/95 border-slate-200/80 shadow-md">
                <img
                  src={qrModal === "contact" ? contactQr : sponsorQr}
                  alt={qrModal === "contact" ? "微信二维码" : "赞赏码"}
                  className="w-56 h-56 object-contain rounded-xl"
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-[var(--g-text-1)]">猫步可爱 (maobukeai)</p>
                <p className="text-[11px] text-[var(--g-text-3)] mt-1">
                  {qrModal === "contact"
                    ? "微信扫一扫添加好友，交流反馈与需求建议"
                    : "感谢您对猫步翻译开源项目的大力支持与鼓励！"}
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 方案 C · Mac 极简艺廊：1. 居中对称 Hero 品牌玻璃卡 */}
      <div className="vision-gallery-card rounded-[24px] px-6 py-7 flex flex-col items-center text-center space-y-4">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-[22px] p-2 border shadow-lg ${
            isLight
              ? "bg-white/85 border-white shadow-sky-500/12"
              : "bg-white/[0.06] border-white/15 shadow-black/40"
          }`}
        >
          <img src={appIcon} alt="猫步翻译 Logo" className="h-16 w-16 object-contain select-none" />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold tracking-tight text-[var(--g-text-1)]">
              猫步翻译 (Maobu Translator)
            </h1>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-mono font-bold bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-border)]">
              v{currentVer}
            </span>
          </div>
          <p className="text-xs text-[var(--g-text-3)] flex items-center justify-center gap-1.5">
            <span>作者 / 开发团队：</span>
            <strong className="text-[var(--g-text-1)] font-semibold">猫步可爱</strong>
            <span className="font-mono text-[11px] opacity-75">(maobukeai)</span>
          </p>
        </div>

        <div className="flex items-center justify-center gap-2.5 flex-wrap pt-1">
          <button
            type="button"
            onClick={() => setQrModal("contact")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 active:scale-97 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              isLight
                ? "bg-white/85 border-white hover:bg-white text-slate-700 shadow-2xs"
                : "bg-white/[0.07] border-white/15 hover:bg-white/[0.12] text-zinc-100"
            }`}
          >
            <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
            <span>联系方式</span>
          </button>
          <button
            type="button"
            onClick={() => setQrModal("sponsor")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 active:scale-97 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              isLight
                ? "bg-white/85 border-white hover:bg-white text-slate-700 shadow-2xs"
                : "bg-white/[0.07] border-white/15 hover:bg-white/[0.12] text-zinc-100"
            }`}
          >
            <Heart className="h-3.5 w-3.5 text-rose-500 fill-rose-500/20" />
            <span>赞助支持</span>
          </button>
        </div>
      </div>

      {/* 2. 核心应用服务：3 列独立艺廊玻璃卡 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {/* 卡片 1：应用更新检查 */}
        <div className="vision-gallery-card rounded-[24px] p-4.5 flex flex-col justify-between space-y-3">
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-[var(--g-text-1)] flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>应用更新检查</span>
            </h3>
            <p className="text-[11px] text-[var(--g-text-3)] leading-relaxed">
              查询 GitHub Releases 最新版本并手动校验。
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap gap-y-1">
              <button
                type="button"
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate}
                className="px-4 py-1.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-[var(--accent)] to-indigo-600 hover:brightness-110 transition shadow-sm shadow-sky-500/20 flex items-center gap-1.5 cursor-pointer active:scale-97 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)]"
              >
                <RefreshCw className={`h-3 w-3 ${isCheckingUpdate ? "animate-spin" : ""}`} />
                <span>{isCheckingUpdate ? "检查中…" : "检查更新"}</span>
              </button>
              <span className="text-[11px] font-mono text-[var(--g-text-3)]">v{currentVer}</span>
            </div>

            {/* 自动更新与静默升级选项 */}
            <div className="pt-2.5 border-t border-[var(--g-hairline)] space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-[var(--g-text-1)]">启动时自动检查更新</div>
                  <div className="text-[10px] text-[var(--g-text-3)] leading-tight">开机或启动后后台静默探测新版</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.autoCheckUpdate ?? true}
                    onChange={(e) => setAutoCheckUpdate(e.target.checked)}
                    className="sr-only peer"
                    data-testid="about-auto-check-toggle"
                  />
                  <div className="w-8 h-4.5 bg-slate-300/80 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-[var(--accent)]"></div>
                </label>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-[var(--g-text-1)]">全自动静默无感升级</div>
                  <div className="text-[10px] text-[var(--g-text-3)] leading-tight">免点击下一步，自动重启新版</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.autoSilentUpdate ?? false}
                    onChange={(e) => setAutoSilentUpdate(e.target.checked)}
                    className="sr-only peer"
                    data-testid="about-auto-silent-toggle"
                  />
                  <div className="w-8 h-4.5 bg-slate-300/80 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-[var(--accent)]"></div>
                </label>
              </div>
            </div>

            {/* 检查结果呈现 */}
            {updateResult && (
              <div className="space-y-2 pt-1">
                {updateResult.error ? (
                  <div className="text-[11px] p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 space-y-2">
                    <div className="flex items-center gap-1 font-semibold">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>检查失败</span>
                    </div>
                    <p className="text-[10.5px] leading-relaxed opacity-90">{updateResult.error}</p>
                    <button
                      type="button"
                      onClick={() => openLink("https://github.com/maobukeai/catwalk-translator/releases")}
                      className="w-full py-1 text-center font-medium text-[10.5px] rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30 transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>手动访问 GitHub Releases</span>
                    </button>
                  </div>
                ) : updateResult.has_update && updateResult.latest ? (
                  <div className="text-[11px] p-2.5 rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-border)] space-y-2">
                    <div className="flex items-center justify-between font-bold">
                      <div className="flex items-center gap-1">
                        <Sparkles className="h-3.5 w-3.5 shrink-0" />
                        <span>发现新版本 v{updateResult.latest.version}</span>
                      </div>
                      {updateResult.latest.release_date && (
                        <span className="text-[10px] opacity-75 font-normal">
                          {updateResult.latest.release_date.slice(0, 10)}
                        </span>
                      )}
                    </div>

                    {updateResult.latest.release_notes && (
                      <p className="text-[10.5px] line-clamp-3 leading-relaxed opacity-90 whitespace-pre-line bg-black/5 dark:bg-white/5 p-1.5 rounded-lg">
                        {updateResult.latest.release_notes}
                      </p>
                    )}

                    {isDownloadingUpdate && downloadProgress && (
                      <div className="space-y-1.5 p-2 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--accent-border)]">
                        <div className="flex items-center justify-between text-[10.5px]">
                          <span className="font-semibold">
                            {downloadProgress.stage === 'installing' ? '正在安装并重启...' : '正在下载...'}
                          </span>
                          <span className="font-mono font-bold">
                            {downloadProgress.percentage.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[var(--accent)] to-indigo-500 transition-all duration-150"
                            style={{ width: `${Math.max(3, Math.min(100, downloadProgress.percentage))}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono opacity-80">
                          <span>
                            {formatBytes(downloadProgress.downloadedBytes)}
                            {downloadProgress.totalBytes > 0 && ` / ${formatBytes(downloadProgress.totalBytes)}`}
                          </span>
                          {downloadProgress.speedBytesPerSec > 0 && downloadProgress.stage !== 'installing' && (
                            <span className="text-emerald-500 font-semibold">
                              {formatBytes(downloadProgress.speedBytesPerSec)}/s
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5 pt-1">
                      <button
                        type="button"
                        disabled={isDownloadingUpdate}
                        onClick={handleInAppUpdate}
                        className="w-full py-1.5 text-center font-bold text-xs rounded-full bg-gradient-to-r from-[var(--accent)] to-indigo-600 hover:brightness-110 text-white shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isDownloadingUpdate ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            <span>{downloadStatus || "正在下载更新包..."}</span>
                          </>
                        ) : (
                          <>
                            <Download className="h-3.5 w-3.5" />
                            <span>⚡ 软件内一键下载并升级</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => openLink(updateResult.latest?.download_url || "https://github.com/maobukeai/catwalk-translator/releases")}
                        className="w-full py-1 text-center font-medium text-[10.5px] rounded-full bg-[var(--accent-soft)] hover:brightness-110 text-[var(--accent-text)] border border-[var(--accent-border)] transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>在浏览器中打开 GitHub Release</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    <div className="flex items-center gap-1">
                      <Check className="h-3 w-3 shrink-0" />
                      <span>已是最新版 (v{updateResult.current_version})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openLink("https://github.com/maobukeai/catwalk-translator/releases")}
                      className="underline hover:opacity-80 cursor-pointer ml-2 text-[10.5px]"
                    >
                      前往 Release 页
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 卡片 2：本地离线模型与词库 */}
        <div className="vision-gallery-card rounded-[24px] p-4.5 flex flex-col justify-between space-y-3">
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-[var(--g-text-1)] flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-purple-500" />
              <span>离线模型与词库</span>
            </h3>
            <p className="text-[11px] text-[var(--g-text-3)] leading-relaxed">
              管理本地 ONNX OCR 轻量模型与 3D/CG 专业术语离线词典。
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-[11px] text-[var(--g-text-2)] space-y-1">
              <div>
                • OCR 模型：
                {ocrModelReady === null ? (
                  <span className="font-semibold">检测中…</span>
                ) : ocrModelReady ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">已就绪 (本地 ONNX)</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">未安装（当前降级系统 OCR）</span>
                )}
              </div>
              <div>• CG 词库：<span className="text-[var(--accent-text)] font-semibold">4,800+ 离线词条</span></div>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 active:scale-97 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                  isLight
                    ? "bg-white/85 border-white hover:bg-white text-slate-700 shadow-2xs"
                    : "bg-white/[0.07] border-white/15 hover:bg-white/[0.12] text-zinc-100"
                }`}
              >
                <Settings className="h-3 w-3" />
                <span>管理离线模型</span>
              </button>
            )}
          </div>
        </div>

        {/* 卡片 3：开源项目主页 */}
        <div className="vision-gallery-card rounded-[24px] p-4.5 flex flex-col justify-between space-y-3">
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-[var(--g-text-1)] flex items-center gap-1.5">
              <Globe2 className="h-3.5 w-3.5 text-indigo-500" />
              <span>开源项目主页</span>
            </h3>
            <p className="text-[11px] text-[var(--g-text-3)] leading-relaxed">
              访问 GitHub 仓库获取最新源码、提交 Issue 与参与共建。
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => openLink("https://github.com/maobukeai/catwalk-translator")}
              className="px-4 py-1.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-[var(--accent)] to-indigo-600 hover:brightness-110 transition shadow-sm shadow-sky-500/20 flex items-center gap-1.5 cursor-pointer active:scale-97 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)]"
            >
              <ExternalLink className="h-3 w-3" />
              <span>访问 GitHub 仓库</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. 软件技术架构独立玻璃卡 */}
      <div className="vision-gallery-card rounded-[24px] p-4.5 space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--g-text-1)] flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span>软件技术架构</span>
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs text-[var(--g-text-2)]">
          <div
            className="p-3 rounded-2xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] space-y-1"
            title="React 19 + TypeScript + Vite + Tailwind CSS，配合高审美 Liquid Glass 质感与丝滑交互"
          >
            <div className="font-bold text-[11.5px] text-[var(--g-text-1)] truncate">
              🎨 前端展示层
            </div>
            <p className="text-[10.5px] text-[var(--g-text-3)] truncate">
              React 19 · Vite · Liquid Glass
            </p>
          </div>

          <div
            className="p-3 rounded-2xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] space-y-1"
            title="Rust 核心 + Tauri v2 框架，极高执行性能与近零待机内存开销"
          >
            <div className="font-bold text-[11.5px] text-[var(--g-text-1)] truncate">
              🦀 桌面后端层
            </div>
            <p className="text-[10.5px] text-[var(--g-text-3)] truncate">
              Rust 核心 · Tauri v2 · 轻量低载
            </p>
          </div>

          <div
            className="p-3 rounded-2xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] space-y-1"
            title="ONNX Runtime 硬件加速 + PaddleOCR 离线文字识别 + 嵌入式 CG 3D 专业词库"
          >
            <div className="font-bold text-[11.5px] text-[var(--g-text-1)] truncate">
              ⚡ 本地离线引擎
            </div>
            <p className="text-[10.5px] text-[var(--g-text-3)] truncate">
              ONNX · PaddleOCR · CG 词库
            </p>
          </div>

          <div
            className="p-3 rounded-2xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] space-y-1"
            title="支持 Google / 微软 Bing / DeepL / 百度 / MyMemory 以及大模型 AI 深度翻译（DeepSeek / Gemini / OpenAI / Ollama）"
          >
            <div className="font-bold text-[11.5px] text-[var(--g-text-1)] truncate">
              🌐 智能多引擎中继
            </div>
            <p className="text-[10.5px] text-[var(--g-text-3)] truncate">
              主流翻译源 · 多 LLM · 30+ 语种
            </p>
          </div>
        </div>
      </div>

      {/* 4. 翻译引擎与平台兼容性矩阵（带滑动筛选胶囊） */}
      <div className="vision-gallery-card rounded-[24px] p-4.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--g-text-1)] flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>翻译引擎与服务兼容性</span>
            </h2>
            <span className="text-[10.5px] text-[var(--g-text-3)] font-medium">
              ({filteredEngines.length}/{ENGINE_COMPATIBILITY_LIST.length})
            </span>
          </div>

          <div
            ref={matrixSlider.containerRef}
            className={`relative inline-flex items-center p-0.5 rounded-full border text-[11px] ${
              isLight
                ? "bg-slate-200/60 border-white/80"
                : "bg-white/[0.06] border-white/10"
            }`}
          >
            <SlidingHighlight
              rect={matrixSlider.rect}
              isReady={matrixSlider.isReady}
              variant="solid"
              radiusClass="rounded-full"
              testId="about-matrix-slider"
            />
            {ENGINE_FILTER_TABS.map((tab) => {
              const active = matrixFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={matrixSlider.registerItem(tab.id)}
                  type="button"
                  onClick={() => setMatrixFilter(tab.id)}
                  data-testid={`about-filter-${tab.id}`}
                  className={`relative z-10 px-3 py-1 rounded-full font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                    active
                      ? matrixSlider.isReady
                        ? "text-white"
                        : "bg-[var(--accent)] text-white shadow-xs"
                      : isLight
                        ? "text-slate-600 hover:text-slate-900"
                        : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {filteredEngines.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.name}
                className="p-3 rounded-2xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] hover:border-[var(--accent-border)] transition space-y-1.5"
              >
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-[var(--g-text-1)] min-w-0">
                    <Icon className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </div>
                  <span
                    className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-semibold border shrink-0 ${getBadgeStyle(
                      item.badgeType
                    )}`}
                  >
                    {item.badge}
                  </span>
                </div>
                <p
                  className="text-[10.5px] text-[var(--g-text-3)] leading-snug line-clamp-2"
                  title={item.description}
                >
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
