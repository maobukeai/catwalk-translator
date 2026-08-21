import React, { useEffect } from 'react';

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  selection: MousePointer2,
  card: Copy,
  channel: Sliders,
  help: CircleHelp,
};
import { X, Keyboard, MousePointer2, Copy, Sliders, CircleHelp } from 'lucide-react';

export interface CheatSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  label: string;
  keys: string[];
}

interface ShortcutCategory {
  id: string;
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    id: 'selection',
    title: '选区操作',
    items: [
      { label: '拖拽划词', keys: ['左键拖拽'] },
      { label: '松手后拖边角缩放选区', keys: ['8 控制点'] },
      { label: '松手后拖动选区移动', keys: ['拖动内部'] },
      { label: '方向键微调（Shift=10px）', keys: ['↑↓←→'] },
      { label: '双击智能吸附段落', keys: ['双击'] },
      { label: 'Enter 确认识别（无选区=全屏）', keys: ['Enter'] },
      { label: 'Shift+拖拽多选', keys: ['Shift', '拖拽'] },
      { label: 'Esc 取消选区 / 退出', keys: ['Esc'] },
      { label: '锁定时连按两次 Esc 强退', keys: ['Esc', 'Esc'] },
      { label: 'R 重划上次选区（结果页可用）', keys: ['R'] },
      { label: 'F4开关', keys: ['F4'] },
    ],
  },
  {
    id: 'card',
    title: '卡片操作',
    items: [
      { label: 'Ctrl+P锁定', keys: ['Ctrl', 'P'] },
      { label: 'Enter/Ctrl+C复制', keys: ['Enter', 'Ctrl+C'] },
      { label: 'Space语音朗读', keys: ['Space'] },
      { label: 'Ctrl+D收藏', keys: ['Ctrl', 'D'] },
      { label: '卡片右键菜单（复制/朗读/收藏/隐藏）', keys: ['右键'] },
      { label: 'O 译文/原文/双语对照', keys: ['O'] },
      { label: '↑↓ 切换激活卡片', keys: ['↑', '↓'] },
      { label: 'Ctrl+滚轮 缩放卡片字号', keys: ['Ctrl', '滚轮'] },
    ],
  },
  {
    id: 'channel',
    title: '模式通道',
    items: [
      { label: 'M 原位覆盖/有道面板', keys: ['M'] },
      { label: 'W 区域监控模式', keys: ['W'] },
      { label: 'H 悬停取词（全局 Ctrl+Alt+H）', keys: ['H'] },
      { label: 'Tab切AI模型', keys: ['Tab'] },
      { label: '1~6切换语种', keys: ['1~6'] },
    ],
  },
  {
    id: 'help',
    title: '帮助指引',
    items: [
      { label: '?/F1速查', keys: ['?', 'F1'] },
      { label: '选区旁放大镜自动跟随光标', keys: ['自动'] },
    ],
  },
];

export const CheatSheetModal: React.FC<CheatSheetModalProps> = ({ isOpen, onClose }) => {
  const modalRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const focusableElementsString = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(focusableElementsString);
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };

    // Auto focus close button initially
    setTimeout(() => {
      if (modalRef.current) {
        const closeBtn = modalRef.current.querySelector('button');
        if (closeBtn) closeBtn.focus();
      }
    }, 50);

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      data-testid="cheatsheet-modal-overlay"
    >
      <div
        ref={modalRef}
        className="lg-surface relative w-full max-w-3xl p-6 space-y-6 transition-all animate-in zoom-in-95 duration-150 overflow-hidden !rounded-2xl border"
        style={{
          background: 'var(--g-surface-solid)',
          color: 'var(--g-text-1)',
          borderColor: 'var(--g-border-strong)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cheatsheet-title"
      >
        {/* Ambient Top Glow Accent */}
        <div className="absolute -top-24 -left-24 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: 'var(--g-border)' }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-500 shadow-inner">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2 id="cheatsheet-title" className="text-lg font-bold tracking-tight flex items-center gap-2" style={{ color: 'var(--g-text-1)' }}>
                快捷键速查面板
                <span className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/30 text-sky-400 font-mono">
                  Liquid Glass
                </span>
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--g-text-2)' }}>
                高效触控与全局热键操作指南 (按 Esc / ? / F1 退出)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭速查面板"
            className="flex items-center justify-center w-8 h-8 rounded-lg border transition cursor-pointer hover:bg-[var(--g-surface-3)]"
            style={{
              borderColor: 'var(--g-border)',
              background: 'var(--g-surface-2)',
              color: 'var(--g-text-2)',
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: 4 Category Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SHORTCUT_CATEGORIES.map((category) => (
            <div
              key={category.id}
              className="lg-panel rounded-xl p-4 space-y-3 shadow-lg transition"
              data-testid={`category-${category.id}`}
              style={{
                background: 'var(--g-surface-2)',
                borderColor: 'var(--g-border)',
              }}
            >
              <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-2" style={{ color: 'var(--accent-text)', borderColor: 'var(--g-hairline)' }}>
                {(() => { const CatIcon = CATEGORY_ICONS[category.id] || Keyboard; return <CatIcon className="h-4 w-4" />; })()}
                <span>{category.title}</span>
              </h3>

              <div className="space-y-2">
                {category.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs py-1 px-2 rounded-lg hover:bg-[var(--g-surface-3)] transition"
                  >
                    <span className="font-medium" style={{ color: 'var(--g-text-1)' }}>{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, kIdx) => (
                        <React.Fragment key={kIdx}>
                          {kIdx > 0 && <span className="text-[10px]" style={{ color: 'var(--g-text-3)' }}>+</span>}
                          <kbd className="px-2 py-0.5 text-xs font-mono font-semibold rounded-md shadow-xs inline-flex items-center justify-center min-w-[24px]">
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Modal Footer / Guidance */}
        <div className="flex items-center justify-between pt-2 text-[11px] border-t" style={{ borderColor: 'var(--g-border)', color: 'var(--g-text-3)' }}>
          <div className="flex items-center gap-1.5" style={{ color: 'var(--g-text-2)' }}>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>符合 WCAG 4.5:1 AA 对比度标准</span>
          </div>
          <div className="flex items-center gap-2">
            <span>按 <kbd className="px-1.5 py-0.5 text-[10px] font-mono">Esc</kbd> 、 <kbd className="px-1.5 py-0.5 text-[10px] font-mono">?</kbd> 或 <kbd className="px-1.5 py-0.5 text-[10px] font-mono">F1</kbd> 可关闭</span>
          </div>
        </div>
      </div>
    </div>
  );
};
