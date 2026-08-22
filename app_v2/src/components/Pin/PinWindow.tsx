import React, { useCallback, useEffect, useRef, useState } from "react";
import { cmdClosePin, cmdGetPinPayload, isTauri } from "../../services/tauri";
import type { PinPayload } from "../../services/types";
import { speakText } from "../../services/tts";

/**
 * 贴图窗口根组件：仅在 label = pin_* 的独立置顶小窗中渲染（main.tsx 路由）。
 * - 拖拽：容器与标题栏带 data-tauri-drag-region（按钮等子元素不受影响）
 * - 缩放：滚轮调整字号（0.7x ~ 1.6x）
 * - 折叠：标题栏 ▾/▸ 按钮收起内容区（只留标题栏，悬停对照时省屏幕）
 * - 自适应高度：ResizeObserver 测量实际内容高度并同步窗口尺寸
 * - 内容更新：cmdOpenPin 对已存在贴图会广播 pin-updated 事件（不重置用户拖动的位置）
 */
export function PinWindowApp() {
  const [payload, setPayload] = useState<PinPayload | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pinIdRef = useRef<string>("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(
      (typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "")
    ).get("pin");
    if (!id) return;
    pinIdRef.current = id;

    let disposed = false;
    cmdGetPinPayload(id).then((p) => {
      if (!disposed && p) setPayload(p);
    });

    // 已存在的贴图被再次"贴"出新内容时刷新（保留用户拖动后的位置）
    let unlisten: (() => void) | null = null;
    if (isTauri()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen<PinPayload>("pin-updated", (event) => {
          if (!disposed && event.payload && event.payload.id === pinIdRef.current) {
            setPayload(event.payload);
          }
        }).then((u) => {
          if (disposed) u();
          else unlisten = u;
        });
      });
    }

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  // 内容自适应窗口高度：测量根容器实际高度并同步到窗口（防抖 + 上限保护）。
  // 生产环境（Tauri）生效；测试/浏览器环境无 ResizeObserver 或窗口 API 时静默跳过。
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !isTauri()) return;
    const el = rootRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      timer = null;
      const h = Math.max(
        collapsed ? 34 : 120,
        Math.min(el.scrollHeight + 4, Math.round(window.screen.availHeight * 0.85))
      );
      import("@tauri-apps/api/window").then(({ getCurrentWindow, LogicalSize }) => {
        getCurrentWindow()
          .setSize(new LogicalSize(window.innerWidth, h))
          .catch(() => undefined);
      });
    };

    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(apply, 120);
    });
    observer.observe(el);
    apply();
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [collapsed, payload, fontScale]);

  const handleClose = useCallback(async () => {
    const id = pinIdRef.current || payload?.id || "";
    if (id) await cmdClosePin(id).catch(() => undefined);
    // 窗口由 Rust 侧关闭；兜底再尝试原生 close
    if (isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().close().catch(() => undefined)
      );
    }
  }, [payload]);

  const handleCopyAll = useCallback(() => {
    if (!payload) return;
    const all = payload.blocks
      .map((b) => b.translated || b.original)
      .filter(Boolean)
      .join("\n");
    if (!all) return;
    navigator.clipboard.writeText(all).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [payload]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setFontScale((s) => Math.min(1.6, Math.max(0.7, Math.round((s - e.deltaY * 0.001) * 10) / 10)));
  }, []);

  if (!payload) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-[11px] text-zinc-500">
        加载贴图内容…
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="flex w-screen flex-col overflow-hidden rounded-xl border border-white/10 bg-[#101218]/95 text-zinc-100 shadow-2xl backdrop-blur-xl select-none"
      onWheel={handleWheel}
      data-tauri-drag-region
    >
      {/* 标题栏：拖拽区 + 操作按钮 */}
      <div
        className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-2.5 py-1.5"
        data-tauri-drag-region
      >
        <div className="flex min-w-0 items-center gap-1.5" data-tauri-drag-region>
          <span className="text-[11px]">📌</span>
          <span
            className={`truncate text-[11px] font-semibold text-zinc-300 ${collapsed ? "" : "max-w-[220px]"}`}
            data-tauri-drag-region
            title={payload.title || "猫步翻译 · 贴图"}
          >
            {collapsed ? `${payload.title || "贴图"} · ${payload.blocks.length} 段` : payload.title || "猫步翻译 · 贴图"}
          </span>
          {collapsed && (
            <span className="truncate text-[10px] text-zinc-400" data-tauri-drag-region>
              {payload.blocks[0]?.translated || payload.blocks[0]?.original || ""}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:bg-white/10 hover:text-white"
            title={collapsed ? "展开全部内容" : "折叠（只留标题与首条译文）"}
            data-testid="pin-collapse"
          >
            {collapsed ? "▸" : "▾"}
          </button>
          {!collapsed && (
            <>
              <button
                type="button"
                onClick={() => setFontScale((s) => Math.min(1.6, Math.round((s + 0.1) * 10) / 10))}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:bg-white/10 hover:text-white"
                title="放大 (也可滚轮)"
              >
                ＋
              </button>
              <button
                type="button"
                onClick={() => setFontScale((s) => Math.max(0.7, Math.round((s - 0.1) * 10) / 10))}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:bg-white/10 hover:text-white"
                title="缩小 (也可滚轮)"
              >
                －
              </button>
              <button
                type="button"
                onClick={handleCopyAll}
                className={`rounded-md px-1.5 py-0.5 text-[11px] transition hover:bg-white/10 ${
                  copied ? "text-emerald-400" : "text-zinc-400 hover:text-white"
                }`}
                title="复制全部译文"
              >
                {copied ? "已复制" : "复制"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void handleClose()}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:bg-red-500/20 hover:text-red-400"
            title="关闭贴图"
            data-testid="pin-close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 内容区：原文（小）→ 译文（主）；超高时内部滚动 */}
      {!collapsed && (
        <div className="scrollbar-thin max-h-[80vh] flex-1 space-y-1.5 overflow-y-auto px-3 py-2.5">
          {payload.blocks.length === 0 && (
            <div className="py-6 text-center text-[11px] text-zinc-500">（无内容）</div>
          )}
          {payload.blocks.map((b, i) => (
            <div
              key={i}
              className="group rounded-lg border border-white/[0.05] bg-white/[0.03] px-2.5 py-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className="text-zinc-500"
                  style={{ fontSize: `${10 * fontScale}px`, lineHeight: 1.5 }}
                >
                  {b.original}
                </p>
                <button
                  type="button"
                  onClick={() => speakText(b.original)}
                  className="shrink-0 rounded px-1 text-[10px] text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-zinc-300"
                  title="朗读原文"
                >
                  🔊
                </button>
              </div>
              <p
                className="mt-0.5 font-medium text-zinc-100"
                style={{ fontSize: `${12.5 * fontScale}px`, lineHeight: 1.55 }}
              >
                {b.translated || b.original}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 底部状态条：来源层级 + 缩放指示 */}
      {!collapsed && (
        <div className="flex items-center justify-between border-t border-white/[0.06] px-2.5 py-1">
          <span className="truncate text-[9.5px] text-zinc-600">
            {payload.blocks[0]?.sourceTier || "猫步翻译"}
          </span>
          <span className="shrink-0 font-mono text-[9.5px] text-zinc-600">
            {fontScale.toFixed(1)}x · 滚轮缩放 · 拖拽移动 · ▾ 折叠
          </span>
        </div>
      )}
    </div>
  );
}
