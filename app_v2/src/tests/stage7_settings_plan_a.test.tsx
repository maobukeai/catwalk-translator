import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsDashboard } from "../components/Settings/SettingsDashboard";
import { useSettingsStore } from "../stores/useSettingsStore";
import { DEFAULT_SETTINGS } from "../services/defaultSettings";

describe("Stage 7 Plan A: SettingsDashboard Vision 左导右览控制中心", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      isDirty: false,
      isLoading: false,
      isSaving: false,
      toastMessage: null,
      fetchSettings: async () => {},
    });
  });

  it("renders sticky sidebar, search input, grouped categories, and sticky header", () => {
    render(<SettingsDashboard />);

    const sidebar = screen.getByTestId("settings-workspace-sidebar");
    const stickyHeader = screen.getByTestId("settings-sticky-header");
    const navSlider = screen.getByTestId("settings-nav-slider");

    expect(sidebar).toBeInTheDocument();
    expect(sidebar.className).toContain("settings-sidebar-glass");
    expect(navSlider).toBeInTheDocument();
    expect(navSlider.className).toContain("vision-sliding-indicator");
    expect(stickyHeader).toBeInTheDocument();
    expect(stickyHeader.className).toContain("settings-sticky-header");
    expect(screen.getByTestId("settings-search-input")).toBeInTheDocument();
    expect(screen.getByText("视觉与交互")).toBeInTheDocument();
    expect(screen.getByText("引擎与词库")).toBeInTheDocument();
    expect(screen.getByText("系统与数据")).toBeInTheDocument();
  });

  it("switches category via grouped nav and updates sticky header title", () => {
    render(<SettingsDashboard />);

    fireEvent.click(screen.getByRole("button", { name: /备份与同步/i }));
    const header = screen.getByTestId("settings-sticky-header");
    expect(header).toHaveTextContent("备份与同步");
    expect(header).toHaveTextContent("WebDAV");
  });

  it("filters settings via search box and jumps directly to matched category & OCR card", async () => {
    render(<SettingsDashboard />);

    const searchInput = screen.getByTestId("settings-search-input");
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "WebDAV" } });

    const resultsPopover = screen.getByTestId("settings-search-results");
    expect(resultsPopover).toHaveTextContent("本地快照导出与 WebDAV 云端同步");

    fireEvent.click(screen.getByText("本地快照导出与 WebDAV 云端同步"));
    expect(screen.getByTestId("settings-sticky-header")).toHaveTextContent("备份与同步");
    expect(screen.queryByTestId("settings-search-results")).toBeNull();

    // Search OCR and jump directly to OCR models card
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "OCR" } });
    fireEvent.click(screen.getByText("离线 OCR 识别模型下载与管理"));
    expect(await screen.findByTestId("ocr-models-card")).toBeInTheDocument();
  });

  it("supports compact bottom quick links for OCR 模型 and 翻译通道", async () => {
    render(<SettingsDashboard />);

    fireEvent.click(screen.getByRole("button", { name: "OCR 模型" }));
    expect(await screen.findByTestId("ocr-models-card")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "翻译通道" }));
    expect(screen.getByTestId("settings-sticky-header")).toHaveTextContent("在线引擎");
  });
});
