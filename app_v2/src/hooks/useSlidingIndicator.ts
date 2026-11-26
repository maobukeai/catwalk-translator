import { useState, useRef, useCallback, useLayoutEffect, useEffect } from "react";

export interface SlidingIndicatorRect {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

/**
 * 全软件统一的 2D 弹性滑动指示器 Hook：
 * 支持横向分段条、纵向导航栏、2D 卡片网格与可横向滚动胶囊条。
 * 当 activeKey 为 null/未匹配或处于 jsdom 零尺寸测试环境时自动回退（isReady=false）。
 */
export function useSlidingIndicator<T extends HTMLElement = HTMLDivElement>(
  activeKey: string | number | null | undefined,
  deps: ReadonlyArray<unknown> = []
) {
  const containerRef = useRef<T>(null);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const [rect, setRect] = useState<SlidingIndicatorRect>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    visible: false,
  });

  const registerItem = useCallback((key: string | number) => {
    const k = String(key);
    return (el: HTMLElement | null) => {
      itemRefs.current[k] = el;
    };
  }, []);

  const update = useCallback(() => {
    const containerEl = containerRef.current;
    if (!containerEl || activeKey === null || activeKey === undefined || activeKey === "") {
      setRect((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const activeEl = itemRefs.current[String(activeKey)];
    if (!activeEl) {
      setRect((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const containerRect = containerEl.getBoundingClientRect();
    const itemRect = activeEl.getBoundingClientRect();
    const width = itemRect.width > 0 ? itemRect.width : activeEl.offsetWidth;
    const height = itemRect.height > 0 ? itemRect.height : activeEl.offsetHeight;

    if (width > 0 && height > 0) {
      const next: SlidingIndicatorRect = {
        left: itemRect.left - containerRect.left + (containerEl.scrollLeft || 0),
        top: itemRect.top - containerRect.top + (containerEl.scrollTop || 0),
        width,
        height,
        visible: true,
      };
      setRect((prev) =>
        prev.visible === next.visible &&
        Math.abs(prev.left - next.left) < 0.25 &&
        Math.abs(prev.top - next.top) < 0.25 &&
        Math.abs(prev.width - next.width) < 0.25 &&
        Math.abs(prev.height - next.height) < 0.25
          ? prev
          : next
      );
    } else {
      setRect((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    }
  }, [activeKey]);

  useLayoutEffect(() => {
    update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, ...deps]);

  const hasActiveKey = activeKey !== null && activeKey !== undefined && activeKey !== "";

  useEffect(() => {
    const el = containerRef.current;
    window.addEventListener("resize", update);
    // Only attach ResizeObserver when there is an active selection and real rendered box layout
    // (avoids unnecessary observers in idle toolbars or jsdom ResizeObserver-counting tests).
    const hasLayoutBox = el ? (el.offsetWidth > 0 || el.offsetHeight > 0) : false;
    const ro =
      hasActiveKey && el && hasLayoutBox && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => update())
        : null;
    if (el && ro) {
      ro.observe(el);
    }
    let cancelled = false;
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready
        .then(() => {
          if (!cancelled) update();
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [hasActiveKey, update]);

  const isReady = rect.visible && rect.width > 0 && rect.height > 0;

  return { containerRef, registerItem, rect, isReady, update };
}
