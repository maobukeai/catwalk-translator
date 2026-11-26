import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AboutPanel } from "../components/MainWindow/AboutPanel";
import { CloseConfirmModal } from "../components/CloseConfirmModal";
import { UpdateModal } from "../components/UpdateModal";
import { OnboardingModal } from "../components/OnboardingModal";
import { OcrModelGuideModal } from "../components/OcrModelGuideModal";
import { CheatSheetModal } from "../components/Overlay/CheatSheetModal";
import { ClipboardToast } from "../components/ClipboardToast";
import { getActiveHarness } from "./harness/tauriIpcMock";

describe("Stage 9 · 关于页 Mac 极简艺廊与统一灵动 Sheet 弹窗体系 (方案 C)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("AboutPanel 渲染 Mac 极简艺廊玻璃卡与兼容矩阵滑动筛选", () => {
    const { container } = render(<AboutPanel />);
    expect(container.querySelectorAll(".vision-gallery-card").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId("about-matrix-slider")).toHaveClass("vision-sliding-indicator");

    // 默认全部 8 项
    expect(screen.getByText("本地离线 OCR")).toBeInTheDocument();
    expect(screen.getByText("微软 Bing 翻译")).toBeInTheDocument();

    // 切换至离线筛选
    fireEvent.click(screen.getByTestId("about-filter-offline"));
    expect(screen.getByText("本地离线 OCR")).toBeInTheDocument();
    expect(screen.queryByText("微软 Bing 翻译")).not.toBeInTheDocument();

    // 切回全部
    fireEvent.click(screen.getByTestId("about-filter-all"));
    expect(screen.getByText("微软 Bing 翻译")).toBeInTheDocument();
  });

  it("四大全局弹窗与快捷键速查均统一使用 .vision-modal-shell", async () => {
    const { container: c1 } = render(<CloseConfirmModal isOpen onClose={vi.fn()} />);
    expect(c1.querySelector(".vision-modal-shell")).toBeInTheDocument();

    const { container: c2 } = render(
      <UpdateModal
        isOpen
        onClose={vi.fn()}
        updateInfo={{
          version: "0.4.0",
          release_date: "2026-11-27",
          download_url: "https://example.com",
          sha256: null,
          release_notes: "测试更新",
          assets: [],
        }}
      />
    );
    expect(c2.querySelector(".vision-modal-shell")).toBeInTheDocument();

    const { container: c3 } = render(<OnboardingModal isOpen onClose={vi.fn()} />);
    expect(c3.querySelector(".vision-modal-shell")).toBeInTheDocument();

    const { container: c4 } = render(<CheatSheetModal isOpen onClose={vi.fn()} />);
    expect(c4.querySelector(".vision-modal-shell")).toBeInTheDocument();

    (window as any).__TAURI_INTERNALS__ = {};
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string) =>
      cmd === "cmd_offline_models_status" ? [] : null
    );
    const { container: c5 } = render(<OcrModelGuideModal onGoDownload={vi.fn()} />);
    expect(await screen.findByTestId("ocr-model-guide")).toBeInTheDocument();
    expect(c5.querySelector(".vision-modal-shell")).toBeInTheDocument();
  });

  it("ClipboardToast 使用高对比度 .vision-toast-shell 与 3.8s 倒计时流光条", () => {
    const { container } = render(
      <ClipboardToast
        payload={{
          id: "toast_stage9",
          original: "Principled BSDF",
          translated: "原理化 BSDF",
          sourceTier: "Preset",
          fromWatch: true,
        }}
        onClose={vi.fn()}
        onDisableWatch={vi.fn()}
      />
    );
    expect(container.querySelector(".vision-toast-shell")).toBeInTheDocument();
    expect(container.querySelector(".vision-toast-life")).toBeInTheDocument();
  });
});
