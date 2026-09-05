import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PinWindowApp } from "./components/Pin/PinWindow";
import { LookupPopupApp } from "./components/Lookup/LookupPopup";
import { isTauri } from "./services/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// 贴图窗口（label = pin_*）复用同一前端产物，经 URL hash 路由到精简的
// PinWindowApp，而不是整个主应用（不加载主窗口状态、Dock 与托盘逻辑）。
// getCurrentWindow 仅在 Tauri 内调用（浏览器侧 import 本身是安全的）。
function resolveWindowKind(): "pin" | "lookup" | "main" {
  if (!isTauri()) return "main";
  try {
    const label = getCurrentWindow().label;
    if (label.startsWith("pin_")) return "pin";
    if (label === "lookup_popup") return "lookup";
    return "main";
  } catch {
    return "main";
  }
}

const kind = resolveWindowKind();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {kind === "pin" ? <PinWindowApp /> : kind === "lookup" ? <LookupPopupApp /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);

