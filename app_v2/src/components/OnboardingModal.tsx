import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Download, CheckCircle2, Cpu } from 'lucide-react';
import { useAppTheme } from '../hooks/useAppTheme';
import {
  cmdOfflineModelsStatus,
  cmdDownloadOfflineModel,
  cmdSwitchOcrVersion,
} from '../services/tauri';

/** 新手引导步骤定义(内容与功能一一对应,避免营销话术) */
const STEPS: {
  icon: string;
  title: string;
  desc: string;
  hints: { kbd?: string; text: string }[];
}[] = [
  {
    icon: '⚡',
    title: '截图划词翻译',
    desc: '按热键框选屏幕任意区域(软件界面/图片/视频字幕),识别后译文直接原位覆盖在原文上,背景与文字颜色自动匹配。',
    hints: [
      { kbd: 'F4', text: '开始框选(可在设置中改键)' },
      { kbd: '双击', text: '智能选中整段文字' },
      { kbd: 'W', text: '区域监控:游戏数值/直播弹幕自动刷新翻译' },
    ],
  },
  {
    icon: '🔍',
    title: '三种即时查词',
    desc: '除了截图,还有更快的查词方式——选一种顺手的:',
    hints: [
      { kbd: 'Alt+Space', text: 'Spotlight 居中打字查词(词卡含音标/释义)' },
      { kbd: '划词即弹窗', text: '任意软件选中文字自动弹翻译(设置→快捷键 中开启)' },
      { kbd: 'Ctrl 悬停', text: '按住 Ctrl 停在屏幕文字上弹词卡(同上开启)' },
    ],
  },
  {
    icon: '📚',
    title: '专业词库 + 术语强制表',
    desc: '内置 Blender / Substance / Unity / Unreal / Maya / Houdini 六大 CG 词库。你添加的自定义词条是「术语强制表」:精确命中直接出结果,句子翻译也会强制遵循你的译法。',
    hints: [
      { kbd: '设置', text: '专业词库 → 自定义专业词典' },
      { kbd: 'CSV', text: '支持批量导入导出,换机不丢' },
    ],
  },
  {
    icon: '🛡️',
    title: '数据安全与同步',
    desc: '所有配置(含引擎密钥、词库)本地存储,支持自动备份与 WebDAV 云同步(坚果云等),多台设备术语一致。翻译记忆本地持久化,重复截图零网络延迟。',
    hints: [
      { kbd: '设置', text: '备份与同步 → 测试/保存配置' },
      { kbd: '导出', text: '随时打包 zip 迁移全部数据' },
    ],
  },
];

/**
 * 首次使用引导:四步走完核心功能,首次启动自动展示一次
 * (localStorage: catwalk_onboarding_v1),之后可从 设置→优先级→系统 手动重看。
 */
export const OnboardingModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [step, setStep] = useState(0);
  const { isLight } = useAppTheme();
  const [ocrStatus, setOcrStatus] = useState<{ installed: boolean; downloading: boolean; progress: number }>({
    installed: true,
    downloading: false,
    progress: 0,
  });

  useEffect(() => {
    if (!isOpen) return;
    cmdOfflineModelsStatus()
      .then((models) => {
        if (models && models.length > 0) {
          const anyInstalled = models.some((m) => m.installed);
          setOcrStatus((s) => ({ ...s, installed: anyInstalled }));
        }
      })
      .catch(() => {});
  }, [isOpen]);

  const handleQuickDownloadOcr = async () => {
    setOcrStatus((s) => ({ ...s, downloading: true, progress: 15 }));
    try {
      await cmdDownloadOfflineModel('ppocrv4-det');
      setOcrStatus((s) => ({ ...s, progress: 45 }));
      await cmdDownloadOfflineModel('ppocrv4-rec');
      setOcrStatus((s) => ({ ...s, progress: 85 }));
      await cmdDownloadOfflineModel('ppocrv4-cls');
      setOcrStatus((s) => ({ ...s, progress: 100, installed: true, downloading: false }));
      await cmdSwitchOcrVersion('v4');
    } catch {
      setOcrStatus((s) => ({ ...s, downloading: false }));
    }
  };

  useEffect(() => {
    if (isOpen) setStep(0);
  }, [isOpen]);

  // 键盘:→/Enter 下一步,← 上一步,Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
        if (step === STEPS.length - 1 && (e.key === 'Enter' || e.key === 'ArrowRight')) onClose();
      } else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, step, onClose]);

  if (!isOpen) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className={`fixed inset-0 z-[400] flex items-center justify-center backdrop-blur-md animate-in fade-in duration-150 ${
        isLight ? 'bg-black/30' : 'bg-black/60'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full max-w-lg mx-4 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-150 overflow-hidden ${
          isLight
            ? 'bg-white/98 border border-slate-200/80 text-slate-800'
            : 'bg-zinc-900/95 border border-white/10 text-zinc-100'
        }`}
      >
        {/* 头部 */}
        <div
          className={`flex items-center justify-between px-5 pt-4 pb-2 border-b ${
            isLight ? 'border-slate-100' : 'border-white/[0.04]'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🐾</span>
            <span className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-zinc-100'}`}>
              欢迎使用猫步翻译
            </span>
            <span
              className={`text-[10px] font-mono ${
                isLight ? 'text-slate-400' : 'text-zinc-500'
              }`}
            >
              {step + 1} / {STEPS.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              isLight
                ? 'hover:bg-slate-100 text-slate-400 hover:text-slate-700'
                : 'hover:bg-white/10 text-zinc-400 hover:text-zinc-100'
            }`}
            title="跳过引导"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 步骤内容 */}
        <div className="px-6 py-4 min-h-[240px]">
          <div className="flex items-center gap-3">
            <div
              className={`h-12 w-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${
                isLight
                  ? 'bg-slate-100 border border-slate-200 text-slate-800 shadow-xs'
                  : 'bg-white/[0.06] border border-white/10 text-white'
              }`}
            >
              {current.icon}
            </div>
            <h2
              className={`text-lg font-bold ${
                isLight ? 'text-slate-900' : 'text-zinc-100'
              }`}
            >
              {current.title}
            </h2>
          </div>
          <p
            className={`mt-3 text-[13px] leading-relaxed ${
              isLight ? 'text-slate-600' : 'text-zinc-300'
            }`}
          >
            {current.desc}
          </p>
          <div className="mt-4 space-y-1.5">
            {current.hints.map((h, i) => (
              <div
                key={i}
                className={`flex items-center gap-2.5 text-xs ${
                  isLight ? 'text-slate-600' : 'text-zinc-400'
                }`}
              >
                {h.kbd && (
                  <kbd
                    className={`shrink-0 min-w-[64px] text-center px-2 py-1 rounded-lg font-mono text-[10px] font-medium shadow-2xs ${
                      isLight
                        ? 'bg-slate-100 border border-slate-200 text-slate-700'
                        : 'bg-white/[0.06] border border-white/10 text-zinc-200'
                    }`}
                  >
                    {h.kbd}
                  </kbd>
                )}
                <span>{h.text}</span>
              </div>
            ))}
          </div>

          {step === 0 && !ocrStatus.installed && (
            <div
              className={`mt-3.5 p-3 rounded-xl border flex items-center justify-between gap-3 animate-in fade-in duration-200 ${
                isLight
                  ? 'bg-violet-50/80 border-violet-200/80 text-slate-800'
                  : 'bg-violet-950/20 border-violet-500/30 text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-violet-600/15 text-violet-500 shrink-0">
                  <Cpu className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold">
                    {ocrStatus.downloading ? `正在准备 PP-OCRv4 离线引擎 (${ocrStatus.progress}%)` : '离线 OCR 引擎推荐就绪'}
                  </p>
                  <p className="text-[11px] opacity-75 truncate">
                    无需外网 · 极速毫秒级响应 (~16MB)
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={ocrStatus.downloading}
                onClick={handleQuickDownloadOcr}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white shadow-sm shrink-0 transition cursor-pointer disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{ocrStatus.downloading ? `${ocrStatus.progress}%` : '一键就绪'}</span>
              </button>
            </div>
          )}
          {step === 0 && ocrStatus.installed && (
            <div
              className={`mt-3 px-3 py-2 rounded-lg border flex items-center gap-2 text-xs font-medium animate-in fade-in duration-200 ${
                isLight
                  ? 'bg-emerald-50/80 border-emerald-200 text-emerald-700'
                  : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-400'
              }`}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>离线 OCR 原生引擎已就绪，随时可按 F4 极速截图翻译</span>
            </div>
          )}
        </div>

        {/* 底部:进度点 + 按钮 */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-t ${
            isLight
              ? 'border-slate-200/80 bg-slate-50/70'
              : 'border-white/[0.06] bg-white/[0.02]'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  i === step
                    ? isLight
                      ? 'w-6 bg-blue-600'
                      : 'w-6 bg-blue-500'
                    : isLight
                    ? 'w-1.5 bg-slate-300 hover:bg-slate-400'
                    : 'w-1.5 bg-zinc-600 hover:bg-zinc-500'
                }`}
                aria-label={`第 ${i + 1} 步`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                isLight
                  ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/60'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]'
              }`}
            >
              跳过
            </button>
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                  isLight
                    ? 'border border-slate-200 text-slate-700 hover:bg-slate-200/60'
                    : 'border border-white/10 text-zinc-200 hover:bg-white/[0.06]'
                }`}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                上一步
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
              className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-sm border border-blue-400/40 transition cursor-pointer"
            >
              {isLast ? '开始使用' : '下一步'}
              {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
