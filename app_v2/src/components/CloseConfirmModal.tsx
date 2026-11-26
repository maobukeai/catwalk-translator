import React, { useState, useEffect } from 'react';
import { Power } from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAppTheme } from '../hooks/useAppTheme';
import { cmdExitApp, cmdHideMainWindow, isTauri } from '../services/tauri';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface CloseConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CloseConfirmModal: React.FC<CloseConfirmModalProps> = ({ isOpen, onClose }) => {
  const [rememberChoice, setRememberChoice] = useState(false);
  const { setCloseAction, saveSettings } = useSettingsStore();
  const { isLight } = useAppTheme();

  useEffect(() => {
    if (isOpen) {
      setRememberChoice(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleExitApp = async () => {
    if (rememberChoice) {
      setCloseAction('exit');
      await saveSettings();
    }
    onClose();
    if (isTauri()) {
      try {
        await cmdExitApp();
      } catch (err) {
        console.warn('Exit app command failed, falling back to window.close():', err);
        try {
          await getCurrentWindow().close();
        } catch {
          // ignore
        }
      }
    } else {
      console.log('[Browser Mode] Exit App confirmed');
    }
  };

  const handleMinimizeToTray = async () => {
    if (rememberChoice) {
      setCloseAction('minimize');
      await saveSettings();
    }
    onClose();
    await cmdHideMainWindow();
  };

  return (
    <div
      className="vision-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`vision-modal-shell vision-modal-enter w-full max-w-[360px] rounded-[26px] p-6 select-none overflow-hidden ${
          isLight ? 'text-slate-800' : 'text-slate-100'
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent-text)] shadow-inner">
            <Power className="h-5 w-5" />
          </div>
          <h3 className="text-[16px] font-bold tracking-tight text-[var(--g-text-1)]">关闭窗口</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--g-text-2)]">
            关闭窗口时希望做什么？
          </p>
        </div>

        <div className="mt-5 flex justify-center">
          <label
            className={`inline-flex items-center gap-2 cursor-pointer select-none rounded-full px-3.5 py-1.5 text-[12px] border transition ${
              isLight
                ? 'bg-white/75 border-slate-200/80 text-slate-700 hover:bg-white'
                : 'bg-white/[0.05] border-white/10 text-zinc-200 hover:bg-white/[0.09]'
            }`}
          >
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[var(--accent)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)]"
            />
            <span>记住选择</span>
          </label>
        </div>

        <div className="mt-5 flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleExitApp}
            className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold transition cursor-pointer border active:scale-97 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
              isLight
                ? 'bg-white/85 border-slate-200/90 hover:bg-white text-slate-700 shadow-2xs'
                : 'bg-white/[0.06] border-white/12 hover:bg-white/[0.12] text-zinc-200'
            }`}
          >
            退出程序
          </button>
          <button
            type="button"
            onClick={handleMinimizeToTray}
            className="flex-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-indigo-600 hover:brightness-110 text-white px-4 py-2 text-xs font-semibold shadow-sm shadow-sky-500/20 transition cursor-pointer active:scale-97 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)]"
          >
            最小化到托盘
          </button>
        </div>
      </div>
    </div>
  );
};
