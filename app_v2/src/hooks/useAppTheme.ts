import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/useSettingsStore";
import type { ThemeMode, FontFamilyOption, FontSizeOption } from "../services/types";

export const FONT_FAMILY_MAP: Record<FontFamilyOption, string> = {
  system: "'Segoe UI Variable Text', system-ui, -apple-system, Segoe UI, Roboto, 'Microsoft YaHei UI', 'PingFang SC', sans-serif",
  yahei: "'Microsoft YaHei UI', 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif",
  segoe: "'Segoe UI Variable Text', 'Segoe UI', -apple-system, sans-serif",
  inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', ui-monospace, Consolas, Monaco, monospace",
};

export const FONT_SIZE_MAP: Record<FontSizeOption, string> = {
  small: "13px",
  medium: "14px",
  large: "16px",
  xlarge: "18px",
};

/**
 * 主题与外观唯一裁决者：解析 appearance.theme + fontFamily + fontSize + 系统 prefers-color-scheme，
 * 把 data-theme、--app-font-family、--app-font-size 挂到 <html> 供 CSS 令牌全局消费，并向组件输出 isLight。
 * 多个组件同时调用是安全的（副作用幂等）。
 */
export function useAppTheme(): { isLight: boolean; theme: ThemeMode; resolvedTheme: "dark" | "light"; fontFamily: FontFamilyOption; fontSize: FontSizeOption } {
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const settingsTheme = useSettingsStore((s) => s.settings.theme);
  const rawTheme = appearance?.theme || settingsTheme || "system";
  const theme: ThemeMode = (rawTheme === ("fluent-dark" as any) ? "dark" : rawTheme) as ThemeMode;
  const rawFontFamily: FontFamilyOption = appearance?.fontFamily || "system";
  const rawFontSize: FontSizeOption = appearance?.fontSize || "medium";

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

  useEffect(() => {
    if (typeof document === "undefined") return;
    const fontStr = FONT_FAMILY_MAP[rawFontFamily] || FONT_FAMILY_MAP.system;
    document.documentElement.style.setProperty("--app-font-family", fontStr);
    document.documentElement.setAttribute("data-font", rawFontFamily);

    const sizeStr = FONT_SIZE_MAP[rawFontSize] || FONT_SIZE_MAP.medium;
    document.documentElement.style.setProperty("--app-font-size", sizeStr);
    document.documentElement.setAttribute("data-font-size", rawFontSize);
  }, [rawFontFamily, rawFontSize]);

  return { isLight, theme, resolvedTheme, fontFamily: rawFontFamily, fontSize: rawFontSize };
}

