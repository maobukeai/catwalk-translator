import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Globe, Search, X } from "lucide-react";
import type { LanguageCode, LanguageOption } from "../../services/types";
import { useAppTheme } from "../../hooks/useAppTheme";

interface LanguageDropdownProps {
  label: string;
  value: LanguageCode;
  options: LanguageOption[];
  onChange: (code: LanguageCode) => void;
  detectedName?: string;
  quickCodes?: LanguageCode[];
  showQuickPills?: boolean;
  align?: 'left' | 'right';
  /** 紧凑胶囊桥模式（隐藏外部“源语言：/目标语言：”文字前缀） */
  compact?: boolean;
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
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { isLight } = useAppTheme();

  const selectedOption = options.find((opt) => opt.code === value) || options[0];

  // Auto focus search input when opening
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const filteredOptions = searchQuery.trim()
    ? options.filter(
        (opt) =>
          opt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          opt.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : options;

  // Quick pills (optional)
  const availableQuickPills = options.filter((opt) => quickCodes.includes(opt.code));

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${compact ? 'space-x-1' : 'space-x-2'} font-sans`}>
      <span className={compact ? 'sr-only' : `text-xs font-semibold pl-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>{label}：</span>

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
        title={label}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`vision-select-trigger flex items-center space-x-1.5 ${compact ? 'rounded-full px-2.5 py-1' : 'rounded-xl px-3 py-1.5'} text-xs font-medium cursor-pointer ${
          isOpen ? "is-open" : ""
        }`}
      >
        <Globe className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent-text)" }} />
        <span className="truncate max-w-[150px]">{selectedOption.name}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          style={{ color: isOpen ? "var(--accent-text)" : "var(--g-text-3)" }}
        />
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

      {/* Custom Dropdown Menu Popover (Unified Vision Glass Popover) */}
      {isOpen && (
        <div
          className={`vision-select-popover absolute top-full mt-2 z-[300] min-w-[235px] ${
            align === 'right' ? 'right-0 left-auto' : 'left-0'
          }`}
        >
          <div
            className="vision-select-group-label flex items-center justify-between border-b mb-1.5 pb-1.5"
            style={{ borderColor: "var(--g-hairline)" }}
          >
            <span>选择语言 / Language</span>
            <span className="font-mono opacity-80">({options.length} 种)</span>
          </div>

          {/* Quick Search Input */}
          <div className="px-0.5 mb-1.5">
            <div className="vision-select-search relative flex items-center">
              <Search className="h-3 w-3 absolute left-2.5 pointer-events-none" style={{ color: "var(--g-text-3)" }} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索语言名称或代码 (如: ja, 日语)..."
                className="w-full bg-transparent text-xs pl-7 pr-7 py-1 outline-none font-medium placeholder:text-[11px]"
                style={{ color: "var(--g-text-1)" }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 opacity-60 hover:opacity-100 cursor-pointer"
                  style={{ color: "var(--g-text-2)" }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-0.5 pr-0.5">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = value === opt.code;
                return (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => {
                      onChange(opt.code);
                      setIsOpen(false);
                    }}
                    className={`vision-select-option ${isSelected ? "is-selected" : ""}`}
                  >
                    <span className="truncate pr-2">{opt.name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 ml-1" style={{ color: "var(--accent-text)" }} />}
                  </button>
                );
              })
            ) : (
              <div className="py-4 text-center text-xs" style={{ color: "var(--g-text-3)" }}>
                未找到匹配的语言 "{searchQuery}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
