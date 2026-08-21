import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Sparkles } from "lucide-react";
import { useAppTheme } from "../../hooks/useAppTheme";

export type TranslationStyleType = "literal" | "free" | "terminology";

interface TranslationStyleDropdownProps {
  value?: TranslationStyleType;
  onChange: (style: TranslationStyleType) => void;
}

interface StyleOption {
  value: TranslationStyleType;
  label: string;
  desc: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    value: "literal",
    label: "直译",
    desc: "紧扣原文，严谨对照",
  },
  {
    value: "free",
    label: "流畅",
    desc: "地道通顺，自然易读",
  },
  {
    value: "terminology",
    label: "术语优先",
    desc: "对齐 CG / 行业定名",
  },
];

export const TranslationStyleDropdown: React.FC<TranslationStyleDropdownProps> = ({
  value = "free",
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLight } = useAppTheme();

  const selectedOption =
    STYLE_OPTIONS.find((opt) => opt.value === value) || STYLE_OPTIONS[1];

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

  return (
    <div ref={containerRef} className="relative inline-flex items-center font-sans">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center space-x-1.5 h-8 rounded-xl px-2.5 text-xs font-semibold transition shadow-xs cursor-pointer focus:outline-none ${
          isLight
            ? "bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 shadow-sm"
            : "bg-zinc-800/90 hover:bg-zinc-700/80 text-zinc-200 border border-zinc-700/80"
        } ${isOpen ? "border-blue-500 ring-2 ring-blue-500/20" : ""}`}
        title="AI 译文风格：直译贴近原文 · 流畅意译通顺 · 术语优先保持行业定名一致"
      >
        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
        <span>{selectedOption.label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ${
            isLight ? "text-slate-500" : "text-zinc-400"
          } ${isOpen ? "rotate-180 text-blue-500" : ""}`}
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div
          className={`absolute top-full mt-2 z-[300] min-w-[200px] rounded-2xl p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150 border left-0 ${
            isLight
              ? "bg-white border-slate-300 text-slate-800 shadow-slate-900/15"
              : "bg-[#181822] border-zinc-700 text-zinc-100 shadow-[0_16px_40px_rgba(0,0,0,0.85)]"
          }`}
        >
          <div
            className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border-b mb-1 flex items-center justify-between ${
              isLight ? "text-slate-500 border-slate-200" : "text-zinc-400 border-zinc-800"
            }`}
          >
            <span>译文风格 / Style</span>
          </div>

          <div className="space-y-1">
            {STYLE_OPTIONS.map((opt) => {
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
                        ? "bg-blue-50 text-blue-700 font-bold border border-blue-200"
                        : "bg-blue-600/25 text-blue-300 font-bold border border-blue-400/40"
                      : isLight
                      ? "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                      : "text-zinc-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-semibold">{opt.label}</span>
                    <span
                      className={`text-[10px] ${
                        isSelected
                          ? isLight
                            ? "text-blue-600/80"
                            : "text-blue-300/80"
                          : isLight
                          ? "text-slate-400"
                          : "text-zinc-500"
                      }`}
                    >
                      {opt.desc}
                    </span>
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 ml-2 shrink-0 text-blue-500" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
