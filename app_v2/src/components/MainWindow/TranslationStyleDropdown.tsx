import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Sparkles } from "lucide-react";
import { useAppTheme } from "../../hooks/useAppTheme";
import { useSlidingIndicator } from "../../hooks/useSlidingIndicator";
import { SlidingHighlight } from "../Common/SlidingHighlight";

export type TranslationStyleType = "literal" | "free" | "terminology";

interface TranslationStyleDropdownProps {
  value?: TranslationStyleType;
  onChange: (style: TranslationStyleType) => void;
  /** dropdown: 经典气泡下拉；segmented: 外露三段式滑动胶囊 */
  variant?: "dropdown" | "segmented";
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
  variant = "dropdown",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLight } = useAppTheme();
  const segSlider = useSlidingIndicator<HTMLDivElement>(variant === "segmented" ? value : null, [variant]);

  const selectedOption =
    STYLE_OPTIONS.find((opt) => opt.value === value) || STYLE_OPTIONS[1];

  // Close on outside click or Escape
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

  if (variant === "segmented") {
    return (
      <div
        ref={segSlider.containerRef}
        role="group"
        aria-label="译文风格"
        className="relative inline-flex items-center p-0.5 rounded-full border font-sans"
        style={{
          background: "var(--g-surface-2)",
          borderColor: "var(--g-hairline)",
          boxShadow: "var(--g-inset-top)",
        }}
      >
        {/* 弹簧滑动高亮胶囊 */}
        <SlidingHighlight
          rect={segSlider.rect}
          isReady={segSlider.isReady}
          variant="solid"
          radiusClass="rounded-full"
          className="seg-pill-indicator"
        />
        {STYLE_OPTIONS.map((opt) => {
          const isSelected = opt.value === value;
          return (
            <button
              key={opt.value}
              ref={segSlider.registerItem(opt.value)}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChange(opt.value)}
              title={`${opt.label}：${opt.desc}`}
              className={`relative z-10 px-2.5 py-1 rounded-full text-[11.5px] transition-colors cursor-pointer whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] ${
                isSelected
                  ? "text-white font-semibold"
                  : isLight
                  ? "text-slate-600 hover:text-slate-900 font-medium"
                  : "text-zinc-300 hover:text-white font-medium"
              }`}
              style={isSelected && !segSlider.isReady ? { background: "var(--accent)" } : undefined}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-flex items-center font-sans">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`vision-select-trigger flex items-center space-x-1.5 h-8 rounded-xl px-2.5 text-xs font-semibold cursor-pointer ${
          isOpen ? "is-open" : ""
        }`}
        title="AI 译文风格：直译贴近原文 · 流畅意译通顺 · 术语优先保持行业定名一致"
      >
        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
        <span>{selectedOption.label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          style={{ color: isOpen ? "var(--accent-text)" : "var(--g-text-3)" }}
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div className="vision-select-popover absolute top-full mt-2 z-[300] min-w-[205px] left-0">
          <div
            className="vision-select-group-label border-b mb-1 pb-1.5"
            style={{ borderColor: "var(--g-hairline)" }}
          >
            <span>译文风格 / Style</span>
          </div>

          <div className="space-y-0.5">
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
                  className={`vision-select-option ${isSelected ? "is-selected" : ""}`}
                >
                  <div className="flex flex-col">
                    <span className="font-semibold">{opt.label}</span>
                    <span
                      className="text-[10px] opacity-75"
                      style={{ color: isSelected ? "var(--accent-text)" : "var(--g-text-3)" }}
                    >
                      {opt.desc}
                    </span>
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 ml-2 shrink-0" style={{ color: "var(--accent-text)" }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
