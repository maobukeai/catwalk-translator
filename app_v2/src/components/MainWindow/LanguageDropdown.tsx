import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Globe } from "lucide-react";
import type { LanguageCode, LanguageOption } from "../../services/types";
import { useSettingsStore } from "../../stores/useSettingsStore";

interface LanguageDropdownProps {
  label: string;
  value: LanguageCode;
  options: LanguageOption[];
  onChange: (code: LanguageCode) => void;
  detectedName?: string;
  quickCodes?: LanguageCode[];
  showQuickPills?: boolean;
  align?: 'left' | 'right';
}

export const LanguageDropdown: React.FC<LanguageDropdownProps> = ({
  label,
  value,
  options,
  onChange,
  detectedName,
  quickCodes = ["auto", "en", "zh-CN", "ja"],
  showQuickPills = false,
  align = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { settings } = useSettingsStore();
  const activeTheme = settings.appearance?.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  const selectedOption = options.find((opt) => opt.code === value) || options[0];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Quick pills (optional)
  const availableQuickPills = options.filter((opt) => quickCodes.includes(opt.code));

  return (
    <div ref={containerRef} className="relative inline-flex items-center space-x-2 font-sans">
      <span className={`text-xs font-semibold pl-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>{label}：</span>

      {/* Quick Language Pills (only if enabled) */}
      {showQuickPills && (
        <div className={`hidden sm:flex items-center space-x-1 p-1 rounded-xl border ${
          isLight ? 'bg-slate-200/80 border-slate-300' : 'bg-zinc-900/90 border-zinc-800/80'
        }`}>
          {availableQuickPills.map((opt) => {
            const isSelected = value === opt.code;
            const displayName = opt.code === "auto" ? "自动检测" : opt.name.split(" ")[0];
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => {
                  onChange(opt.code);
                  setIsOpen(false);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-sm"
                    : (isLight ? "text-slate-700 hover:text-slate-900 hover:bg-slate-300/80" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80")
                }`}
              >
                {displayName}
              </button>
            );
          })}
        </div>
      )}

      {/* Custom Dropdown Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center space-x-2 rounded-xl px-3 py-1.5 text-xs font-medium transition shadow-xs cursor-pointer focus:outline-none ${
          isLight
            ? "bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 shadow-sm"
            : "bg-zinc-800/90 hover:bg-zinc-700/80 text-zinc-200 border border-zinc-700/80"
        } ${
          isOpen ? "border-blue-500 ring-2 ring-blue-500/20" : ""
        }`}
      >
        <Globe className="h-3.5 w-3.5 text-blue-500" />
        <span>{selectedOption.name}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${
          isLight ? "text-slate-500" : "text-zinc-400"
        } ${isOpen ? "rotate-180 text-blue-500" : ""}`} />
      </button>

      {/* Auto Detected Tag */}
      {detectedName && (
        <span className={`text-[11px] px-2 py-0.5 rounded-md font-mono animate-pulse border ${
          isLight
            ? "bg-blue-50 border-blue-200 text-blue-700"
            : "bg-blue-500/10 border-blue-500/30 text-blue-400"
        }`}>
          检测到: {detectedName}
        </span>
      )}

      {/* Custom Dropdown Menu Popover (Solid Opaque Background + Custom Scrollbar) */}
      {isOpen && (
        <div
          className={`absolute top-full mt-2 z-[300] min-w-[225px] rounded-2xl p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-150 border ${
            align === 'right' ? 'right-0 left-auto' : 'left-0'
          } ${
            isLight
              ? "bg-white border-slate-300 text-slate-800 shadow-slate-900/15"
              : "bg-[#181822] border-zinc-700 text-zinc-100 shadow-[0_16px_40px_rgba(0,0,0,0.85)]"
          }`}
        >
          <div className={`px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider border-b mb-1 flex items-center justify-between ${
            isLight ? "text-slate-500 border-slate-200" : "text-zinc-400 border-zinc-800"
          }`}>
            <span>选择语言 / Language</span>
            <span className={isLight ? "text-slate-400" : "text-zinc-500"}>({options.length} 种)</span>
          </div>

          <div
            className={`max-h-60 overflow-y-auto space-y-1 pr-1.5 ${
              isLight
                ? "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
                : "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
            }`}
          >
            {options.map((opt) => {
              const isSelected = value === opt.code;
              return (
                <button
                  key={opt.code}
                  type="button"
                  onClick={() => {
                    onChange(opt.code);
                    setIsOpen(false);
                  }}
                  className={`flex items-center justify-between w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                    isSelected
                      ? (isLight ? "bg-blue-50 text-blue-700 font-bold border border-blue-200" : "bg-blue-600/25 text-blue-300 font-bold border border-blue-400/40")
                      : (isLight ? "text-slate-700 hover:bg-slate-100 hover:text-slate-900" : "text-zinc-300 hover:bg-white/10 hover:text-white")
                  }`}
                >
                  <span className="truncate pr-2">{opt.name}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-blue-400 shrink-0 ml-1" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
