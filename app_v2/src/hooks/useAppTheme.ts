import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/useSettingsStore";
import type { ThemeMode } from "../services/types";

/**
 * 主题唯一裁决者：解析 appearance.theme + 系统 prefers-color-scheme，
 * 把 data-theme 挂到 <html> 供 CSS 令牌消费，并向组件输出 isLight。
 * 多个组件同时调用是安全的（副作用幂等）。
 */
export function useAppTheme(): { isLight: boolean; theme: ThemeMode; resolvedTheme: "dark" | "light" } {
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const settingsTheme = useSettingsStore((s) => s.settings.theme);
  const rawTheme = appearance?.theme || settingsTheme || "system";
  const theme: ThemeMode = (rawTheme === ("fluent-dark" as any) ? "dark" : rawTheme) as ThemeMode;
  const [isSystemLight, setIsSystemLight] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: light)").matches
  );

  // 跟随系统深浅色实时变化（theme === 'system' 时生效）
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => setIsSystemLight(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const isLight = theme === "light" || (theme === "system" && isSystemLight);
  const resolvedTheme: "dark" | "light" = isLight ? "light" : "dark";

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.dataset.theme = resolvedTheme;
    if (resolvedTheme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
  }, [resolvedTheme]);

  return { isLight, theme, resolvedTheme };
}
