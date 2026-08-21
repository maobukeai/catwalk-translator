import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Search, X } from "lucide-react";
import { useAppTheme } from "../../hooks/useAppTheme";

export interface GlassSelectOption {
  value: string;
  label: string;
  sub?: string;
  icon?: React.ReactNode;
}

export interface GlassSelectProps {
  value: string;
  options: GlassSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  direction?: "up" | "down";
  align?: "left" | "right";
  size?: "sm" | "md";
  searchable?: boolean;
  title?: string;
  icon?: React.ReactNode;
  className?: string;
}

export const GlassSelect: React.FC<GlassSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = "请选择...",
  direction = "down",
  align = "left",
  size = "md",
  searchable = false,
  title,
  icon,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isLight } = useAppTheme();

  const selectedOption = options.find((opt) => opt.value === value);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto focus search input
  useEffect(() => {
    if (isOpen && searchable) {
      setSearchQuery("");
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen, searchable]);

  // Filtered options
  const filteredOptions = searchable && searchQuery.trim()
    ? options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (opt.sub && opt.sub.toLowerCase().includes(searchQuery.toLowerCase())) ||
          opt.value.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : options;

  const isSmall = size === "sm";

  return (
    <div ref={containerRef} className={`relative inline-block font-sans ${className}`}>
      {/* Hidden Accessible / Form-compatible Select for Tests & Accessibility */}
      <select
        tabIndex={-1}
        aria-hidden="true"
        title={title}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only pointer-events-none absolute inset-0 opacity-0"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center justify-between gap-1.5 rounded-xl border transition shadow-xs cursor-pointer focus:outline-none select-none ${
          isSmall ? "h-7 px-2 text-[11px] font-semibold" : "h-8 px-2.5 text-xs font-semibold"
        } ${
          isLight
            ? "bg-white hover:bg-slate-50 text-slate-800 border-slate-300 shadow-sm"
            : "bg-zinc-800/90 hover:bg-zinc-700/80 text-zinc-200 border-zinc-700/80"
        } ${isOpen ? "border-blue-500 ring-2 ring-blue-500/20" : ""}`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {icon && <span className="shrink-0">{icon}</span>}
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        </div>
        <ChevronDown
          className={`shrink-0 transition-transform duration-200 ${
            isSmall ? "h-3 w-3" : "h-3.5 w-3.5"
          } ${isLight ? "text-slate-500" : "text-zinc-400"} ${
            isOpen ? (direction === "up" ? "" : "rotate-180 text-blue-500") : direction === "up" ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div
          className={`absolute z-[300] min-w-[200px] max-w-[320px] rounded-2xl p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150 border ${
            direction === "up" ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "right" ? "right-0 left-auto" : "left-0"} ${
            isLight
              ? "bg-white border-slate-300 text-slate-800 shadow-slate-900/15"
              : "bg-[#181822] border-zinc-700 text-zinc-100 shadow-[0_16px_40px_rgba(0,0,0,0.85)]"
          }`}
        >
          {/* Optional Search */}
          {searchable && (
            <div className="px-1 mb-1.5">
              <div
                className={`relative flex items-center rounded-lg border transition ${
                  isLight
                    ? "bg-slate-100/90 border-slate-200 focus-within:border-blue-500 focus-within:bg-white"
                    : "bg-zinc-800/90 border-zinc-700/80 focus-within:border-blue-500 focus-within:bg-zinc-800"
                }`}
              >
                <Search
                  className={`h-3 w-3 absolute left-2.5 ${
                    isLight ? "text-slate-400" : "text-zinc-400"
                  }`}
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索选项..."
                  className="w-full bg-transparent pl-7 pr-7 py-1 text-xs outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* List Options */}
          <div
            className={`max-h-56 overflow-y-auto space-y-0.5 pr-0.5 ${
              isLight
                ? "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
                : "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
            }`}
          >
            {filteredOptions.length === 0 ? (
              <div className="py-3 text-center text-xs text-zinc-400">无匹配选项</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                    }}
                    className={`flex items-center justify-between w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                      isSelected
                        ? isLight
                          ? "bg-blue-50 text-blue-700 font-bold border border-blue-200 shadow-xs"
                          : "bg-blue-600/25 text-blue-300 font-bold border border-blue-400/40 shadow-xs"
                        : isLight
                        ? "text-slate-700 hover:bg-slate-100 hover:text-slate-900 border border-transparent"
                        : "text-zinc-300 hover:bg-white/10 hover:text-white border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 pr-2">
                      {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{opt.label}</span>
                        {opt.sub && (
                          <span
                            className={`text-[10px] truncate ${
                              isSelected
                                ? isLight
                                  ? "text-blue-600/80"
                                  : "text-blue-300/80"
                                : isLight
                                ? "text-slate-400"
                                : "text-zinc-500"
                            }`}
                          >
                            {opt.sub}
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-blue-500 ml-1" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
