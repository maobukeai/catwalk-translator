import { useEffect, useState } from "react";
import { cmdGetOcrEngineStatus } from "../services/tauri";
import type { OcrEngineStatus } from "../services/types";

/**
 * OCR 引擎真实状态：挂载时查询一次，之后每 90s 轮询刷新。
 * 浏览器 mock 模式下走 tauri.ts 的本地回退，同样安全。
 */
export function useOcrStatus(pollMs = 90_000): OcrEngineStatus {
  const [status, setStatus] = useState<OcrEngineStatus>({ status: "idle", detail: "" });

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await cmdGetOcrEngineStatus();
        if (!cancelled && res) setStatus(res);
      } catch {
        /* 引擎状态查询失败不阻塞 UI，保留上次结果 */
      }
    };
    refresh();
    const timer = window.setInterval(refresh, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return status;
}
