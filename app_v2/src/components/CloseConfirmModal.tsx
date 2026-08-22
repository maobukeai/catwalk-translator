import React, { useState, useEffect } from 'react';
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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-[340px] rounded-2xl p-5 shadow-2xl transition-all animate-in zoom-in-95 duration-150 border select-none ${
          isLight
            ? 'bg-[#efefef] border-slate-300/80 text-slate-800'
            : 'bg-[#25262b] border-white/10 text-slate-100'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-bold tracking-tight">关闭窗口</h3>
        <p className={`mt-3 text-[13px] leading-relaxed ${isLight ? 'text-slate-600' : 'text-zinc-300'}`}>
          关闭窗口时希望做什么？
        </p>

        <div className="mt-6 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none text-[12.5px]">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="h-4 w-4 rounded border-slate-400/80 text-blue-600 focus:ring-0 focus:outline-none cursor-pointer"
            />
            <span className={isLight ? 'text-slate-700' : 'text-zinc-200'}>记住选择</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExitApp}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition cursor-pointer border shadow-2xs ${
                isLight
                  ? 'bg-white border-slate-300 hover:bg-slate-100 text-slate-700 active:bg-slate-200'
                  : 'bg-zinc-800/80 border-white/10 hover:bg-zinc-700 text-zinc-200 active:bg-zinc-600'
              }`}
            >
              退出程序
            </button>
            <button
              type="button"
              onClick={handleMinimizeToTray}
              className="rounded-lg bg-[#0078d4] hover:bg-[#106ebe] active:bg-[#005a9e] text-white px-3.5 py-1.5 text-xs font-medium shadow-sm transition cursor-pointer"
            >
              最小化到托盘
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
