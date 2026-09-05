import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled React error:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-6 text-slate-100 selection:bg-rose-500">
          <div className="max-w-md w-full rounded-2xl border border-rose-500/30 bg-slate-900/90 p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertTriangle className="w-7 h-7 shrink-0 animate-pulse" />
              <h2 className="text-lg font-bold">界面渲染遇到异常</h2>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              猫步翻译已自动拦截此异常，防止窗口白屏。您可以点击下方按钮刷新重载界面：
            </p>
            {this.state.error && (
              <pre className="text-[11px] font-mono bg-black/40 p-3 rounded-lg border border-white/10 text-rose-300 max-h-36 overflow-auto whitespace-pre-wrap select-text">
                {this.state.error.message || String(this.state.error)}
              </pre>
            )}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-white font-medium text-xs shadow-lg shadow-emerald-900/30 transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>刷新重载界面</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
