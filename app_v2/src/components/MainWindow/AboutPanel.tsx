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
  type AppInfo,
  type UpdateCheckResult,
} from "../../services/tauri";
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
  description: string;
  icon: React.ElementType;
}

const ENGINE_COMPATIBILITY_LIST: EngineCompatibility[] = [
  {
    name: "本地离线 OCR",
    badge: "离线可用",
    badgeType: "offline",
    description: "内置轻量 ONNX 硬件级加速引擎，毫秒级精准文字识别，无网络依赖",
    icon: Zap,
  },
  {
    name: "CG 离线专业词库",
    badge: "离线可用",
    badgeType: "offline",
    description: "涵盖 Blender / Unreal / Unity / Maya 等 3D 材质节点与图形学释义",
    icon: BookOpen,
  },
  {
    name: "微软 Bing 翻译",
    badge: "已验证",
    badgeType: "verified",
    description: "国内直连免密高速通道，超低延迟即时翻译，支持 30+ 语种",
    icon: Globe2,
  },
  {
    name: "Google 翻译",
    badge: "已验证",
    badgeType: "verified",
    description: "全球主流语种多引擎互译，覆盖 30+ 种世界语言",
    icon: Globe2,
  },
  {
    name: "DeepL 极速通道",
    badge: "已验证",
    badgeType: "verified",
    description: "权威高质量自然语言互译，支持官方 API 与自定义自建 DeepLX",
    icon: Boxes,
  },
  {
    name: "AI 深度翻译 (LLM)",
    badge: "大模型",
    badgeType: "ai",
    description: "支持 DeepSeek / Gemini / OpenAI / 本地 Ollama 语义与上下文深度翻译",
    icon: Bot,
  },
  {
    name: "百度通用翻译",
    badge: "已验证",
    badgeType: "verified",
    description: "支持百度官方开放平台 API 密钥接入，稳定可靠",
    icon: ShieldCheck,
  },
  {
    name: "MyMemory 翻译",
    badge: "免配置",
    badgeType: "free",
    description: "全球开放翻译记忆库，开箱即用无需配置密钥",
    icon: Layers,
  },
];

export const AboutPanel: React.FC<AboutPanelProps> = ({ onOpenSettings }) => {
  const { isLight } = useAppTheme();
  const [qrModal, setQrModal] = useState<"contact" | "sponsor" | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    cmdGetAppInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info);
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
    setDownloadStatus("正在下载新版本安装包并准备覆盖升级...");
    try {
      await cmdDownloadAndInstallUpdate(targetUrl);
      setDownloadStatus("安装程序已启动，正在关闭当前应用进行升级...");
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

  return (
    <div className="flex flex-col h-full min-h-0 space-y-4 select-text pb-6">
      {/* 弹窗：微信二维码 / 赞赏码 */}
      {qrModal && typeof document !== "undefined" && createPortal(
        <div 
          onClick={(e) => { if (e.target === e.currentTarget) setQrModal(null); }}
          className={`fixed inset-0 z-[500] flex items-center justify-center p-4 transition-colors animate-in fade-in duration-150 ${
            isLight ? "bg-black/20 backdrop-blur-sm" : "bg-black/60 backdrop-blur-md"
          }`}
        >
          <div
            className={`relative w-full max-w-sm rounded-2xl p-6 shadow-2xl border transition-all animate-in zoom-in-95 duration-150 ${
              isLight
                ? "bg-white/95 backdrop-blur-xl border-slate-200/90 text-slate-800 shadow-2xl"
                : "bg-zinc-900/95 backdrop-blur-xl border-zinc-700/60 text-zinc-100 shadow-2xl"
            }`}
          >
            <button
              type="button"
              onClick={() => setQrModal(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex flex-col items-center text-center space-y-4">
              <h3 className="text-sm font-bold">
                {qrModal === "contact" ? "联系作者 · 微信二维码" : "赞助支持 · 赞赏码"}
              </h3>

              <div className="p-2 rounded-xl border bg-white dark:bg-white/95 border-slate-200 shadow-md">
                <img
                  src={qrModal === "contact" ? contactQr : sponsorQr}
                  alt={qrModal === "contact" ? "微信二维码" : "赞赏码"}
                  className="w-56 h-56 object-contain rounded-lg"
                />
              </div>

              <div>
                <p className="text-xs font-semibold">猫步可爱 (maobukeai)</p>
                <p className="text-[11px] text-slate-400 dark:text-zinc-400 mt-1">
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

      {/* 主信息卡片 */}
      <div className="lg-panel p-5 space-y-5">
        {/* 顶部 Header：Logo、名称、版本、作者与操作按钮 */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--g-hairline)]">
          <div className="flex items-center space-x-3.5">
            <img src={appIcon} alt="猫步翻译 Logo" className="h-14 w-14 object-contain select-none shrink-0" />
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-base font-bold tracking-tight">猫步翻译 (Maobu Translator)</h1>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-mono font-bold bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--g-hairline)]">
                  v{currentVer}
                </span>
              </div>
              <p className="text-xs text-[var(--g-text-3)] mt-1 flex items-center space-x-1.5">
                <span>作者 / 开发团队：</span>
                <strong className="text-[var(--g-text-1)] font-semibold">猫步可爱</strong>
                <span className="font-mono text-[11px] opacity-75">(maobukeai)</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setQrModal("contact")}
              className="lg-btn !px-3 !py-1.5 !text-xs font-semibold flex items-center space-x-1.5"
            >
              <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>联系方式</span>
            </button>
            <button
              type="button"
              onClick={() => setQrModal("sponsor")}
              className="lg-btn !px-3 !py-1.5 !text-xs font-semibold flex items-center space-x-1.5"
            >
              <Heart className="h-3.5 w-3.5 text-rose-500 fill-rose-500/20" />
              <span>赞助支持</span>
            </button>
          </div>
        </div>

        {/* 软件技术架构 */}
        <div className="space-y-1.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--g-text-1)] flex items-center space-x-1.5">
            <Cpu className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>软件技术架构</span>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-[var(--g-text-2)]">
            <div
              className="p-2 rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] space-y-0.5"
              title="React 19 + TypeScript + Vite + Tailwind CSS，配合高审美 Liquid Glass 质感与丝滑交互"
            >
              <div className="font-bold text-[11px] text-[var(--g-text-1)] flex items-center space-x-1 truncate">
                <span>🎨 前端展示层</span>
              </div>
              <p className="text-[10px] text-[var(--g-text-3)] truncate">
                React 19 · Vite · Liquid Glass
              </p>
            </div>

            <div
              className="p-2 rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] space-y-0.5"
              title="Rust 核心 + Tauri v2 框架，极高执行性能与近零待机内存开销"
            >
              <div className="font-bold text-[11px] text-[var(--g-text-1)] flex items-center space-x-1 truncate">
                <span>🦀 桌面后端层</span>
              </div>
              <p className="text-[10px] text-[var(--g-text-3)] truncate">
                Rust 核心 · Tauri v2 · 轻量低载
              </p>
            </div>

            <div
              className="p-2 rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] space-y-0.5"
              title="ONNX Runtime 硬件加速 + PaddleOCR 离线文字识别 + 嵌入式 CG 3D 专业词库"
            >
              <div className="font-bold text-[11px] text-[var(--g-text-1)] flex items-center space-x-1 truncate">
                <span>⚡ 本地离线引擎</span>
              </div>
              <p className="text-[10px] text-[var(--g-text-3)] truncate">
                ONNX · PaddleOCR · CG 词库
              </p>
            </div>

            <div
              className="p-2 rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] space-y-0.5"
              title="支持 Google / 微软 Bing / DeepL / 百度 / MyMemory 以及大模型 AI 深度翻译（DeepSeek / Gemini / OpenAI / Ollama）"
            >
              <div className="font-bold text-[11px] text-[var(--g-text-1)] flex items-center space-x-1 truncate">
                <span>🌐 智能多引擎中继</span>
              </div>
              <p className="text-[10px] text-[var(--g-text-3)] truncate">
                主流翻译源 · 多 LLM · 30+ 语种
              </p>
            </div>
          </div>
        </div>

        {/* 核心应用服务 3 列卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-[var(--g-hairline)]">
          {/* 卡片 1：应用更新检查 */}
          <div className="p-3.5 rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-[var(--g-text-1)] flex items-center space-x-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                <span>应用更新检查</span>
              </h3>
              <p className="text-[11px] text-[var(--g-text-3)] leading-relaxed">
                查询 GitHub Releases 最新版本并手动校验。
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <button
                  type="button"
                  onClick={handleCheckUpdate}
                  disabled={isCheckingUpdate}
                  className="lg-btn lg-btn-primary !px-3 !py-1 !text-xs font-semibold flex items-center space-x-1.5"
                >
                  <RefreshCw className={`h-3 w-3 ${isCheckingUpdate ? "animate-spin" : ""}`} />
                  <span>{isCheckingUpdate ? "检查中…" : "检查更新"}</span>
                </button>
                <span className="text-[11px] font-mono text-[var(--g-text-3)]">v{currentVer}</span>
              </div>

              {/* 检查结果呈现 */}
              {updateResult && (
                <div className="space-y-2 pt-1">
                  {updateResult.error ? (
                    <div className="text-[11px] p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 space-y-2">
                      <div className="flex items-center space-x-1 font-semibold">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>检查失败</span>
                      </div>
                      <p className="text-[10.5px] leading-relaxed opacity-90">{updateResult.error}</p>
                      <button
                        type="button"
                        onClick={() => openLink("https://github.com/maobukeai/catwalk-translator/releases")}
                        className="w-full py-1 text-center font-medium text-[10.5px] rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30 transition flex items-center justify-center space-x-1 cursor-pointer"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>手动访问 GitHub Releases</span>
                      </button>
                    </div>
                  ) : updateResult.has_update && updateResult.latest ? (
                    <div className="text-[11px] p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 space-y-2">
                      <div className="flex items-center justify-between font-bold">
                        <div className="flex items-center space-x-1">
                          <Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                          <span>发现新版本 v{updateResult.latest.version}</span>
                        </div>
                        {updateResult.latest.release_date && (
                          <span className="text-[10px] opacity-75 font-normal">
                            {updateResult.latest.release_date.slice(0, 10)}
                          </span>
                        )}
                      </div>

                      {updateResult.latest.release_notes && (
                        <p className="text-[10.5px] line-clamp-3 leading-relaxed opacity-90 whitespace-pre-line bg-black/5 dark:bg-white/5 p-1.5 rounded">
                          {updateResult.latest.release_notes}
                        </p>
                      )}

                      <div className="space-y-1.5 pt-1">
                        <button
                          type="button"
                          disabled={isDownloadingUpdate}
                          onClick={handleInAppUpdate}
                          className="w-full py-1.5 text-center font-bold text-xs rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md hover:shadow transition flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
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
                          className="w-full py-1 text-center font-medium text-[10.5px] rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 transition flex items-center justify-center space-x-1 cursor-pointer"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>在浏览器中打开 GitHub Release</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      <div className="flex items-center space-x-1">
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
          <div className="p-3.5 rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-[var(--g-text-1)] flex items-center space-x-1.5">
                <Database className="h-3.5 w-3.5 text-purple-500" />
                <span>离线模型与词库</span>
              </h3>
              <p className="text-[11px] text-[var(--g-text-3)] leading-relaxed">
                管理本地 ONNX OCR 轻量模型与 3D/CG 专业术语离线词典。
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] text-[var(--g-text-3)] space-y-0.5">
                <div>• OCR 模型：<span className="text-emerald-500 font-semibold">已就绪 (v2.0 极速轻量)</span></div>
                <div>• CG 词库：<span className="text-blue-500 font-semibold">4,800+ 离线词条</span></div>
              </div>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="lg-btn !px-3 !py-1 !text-xs font-semibold flex items-center space-x-1"
                >
                  <Settings className="h-3 w-3" />
                  <span>管理离线模型</span>
                </button>
              )}
            </div>
          </div>

          {/* 卡片 3：开源项目主页 */}
          <div className="p-3.5 rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-[var(--g-text-1)] flex items-center space-x-1.5">
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
                className="lg-btn lg-btn-primary !px-3 !py-1 !text-xs font-semibold flex items-center space-x-1.5"
              >
                <ExternalLink className="h-3 w-3" />
                <span>访问 GitHub 仓库</span>
              </button>
            </div>
          </div>
        </div>

        {/* 翻译引擎与平台兼容性矩阵 */}
        <div className="space-y-2 pt-2 border-t border-[var(--g-hairline)]">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--g-text-1)] flex items-center space-x-1.5">
              <Layers className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>翻译引擎与服务兼容性</span>
            </h2>
            <span className="text-[10.5px] text-[var(--g-text-3)] font-medium">
              共支持 {ENGINE_COMPATIBILITY_LIST.length} 组翻译引擎与离线组件
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {ENGINE_COMPATIBILITY_LIST.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.name}
                  className="p-2.5 rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface-2)] hover:bg-[var(--g-surface-3)] transition space-y-1"
                >
                  <div className="flex items-center justify-between gap-1.5 min-w-0">
                    <div className="flex items-center space-x-1.5 font-bold text-xs text-[var(--g-text-1)] min-w-0">
                      <Icon className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                      <span className="truncate">{item.name}</span>
                    </div>
                    <span
                      className={`text-[9.5px] px-1.5 py-0.2 rounded-md font-semibold border shrink-0 ${getBadgeStyle(
                        item.badgeType
                      )}`}
                    >
                      {item.badge}
                    </span>
                  </div>
                  <p
                    className="text-[10.5px] text-[var(--g-text-3)] leading-tight truncate"
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
    </div>
  );
};
