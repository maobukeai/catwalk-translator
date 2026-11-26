import React from "react";
import type { SlidingIndicatorRect } from "../../hooks/useSlidingIndicator";

export interface SlidingHighlightProps {
  rect: SlidingIndicatorRect;
  isReady: boolean;
  variant?: "solid" | "glass" | "card";
  radiusClass?: string;
  className?: string;
  testId?: string;
  style?: React.CSSProperties;
}

const VARIANT_STYLES: Record<"solid" | "glass" | "card", React.CSSProperties> = {
  solid: {
    background: "var(--accent)",
    boxShadow: "0 2px 10px color-mix(in srgb, var(--accent) 34%, transparent)",
  },
  glass: {
    background: "var(--accent-soft)",
    border: "1px solid var(--accent-border)",
    boxShadow: "var(--g-inset-top)",
  },
  card: {
    background: "var(--accent-soft)",
    border: "2px solid var(--accent)",
    boxShadow:
      "0 4px 16px -4px color-mix(in srgb, var(--accent) 28%, transparent), var(--g-inset-top)",
  },
};

/**
 * 全软件统一的弹性滑动高亮层组件，配合 useSlidingIndicator 使用。
 * 置于 relative 容器最底层，上方选项按钮添加 `relative z-10`。
 */
export const SlidingHighlight: React.FC<SlidingHighlightProps> = ({
  rect,
  isReady,
  variant = "solid",
  radiusClass = "rounded-xl",
  className = "",
  testId,
  style,
}) => {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className={`vision-sliding-indicator ${radiusClass} ${className}`}
      style={{
        width: rect.width > 0 ? `${rect.width}px` : undefined,
        height: rect.height > 0 ? `${rect.height}px` : undefined,
        transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
        opacity: isReady ? 1 : 0,
        ...VARIANT_STYLES[variant],
        ...style,
      }}
    />
  );
};
