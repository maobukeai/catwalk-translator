import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GlassSelect } from "../components/Common/GlassSelect";
import { SnippingToolbar } from "../components/Overlay/SnippingToolbar";

describe("Unified Vision GlassSelect & Portal Popovers", () => {
  it("renders standalone options + grouped options in hidden select & opens Portal popover in document.body", () => {
    const handleChange = vi.fn();
    render(
      <GlassSelect
        value="auto"
        title="测试分组下拉"
        options={[{ value: "auto", label: "🤖 智能极速" }]}
        groups={[
          {
            key: "ai",
            label: "AI 大语言模型",
            options: [{ value: "deepseek", label: "DeepSeek" }],
          },
          {
            key: "online",
            label: "通用在线翻译",
            options: [{ value: "google", label: "Google 翻译" }],
          },
        ]}
        onChange={handleChange}
      />
    );

    const hiddenSelect = screen.getByTitle("测试分组下拉") as HTMLSelectElement;
    expect(hiddenSelect.querySelectorAll("optgroup")).toHaveLength(2);

    // Hidden select still supports direct form/test change events
    fireEvent.change(hiddenSelect, { target: { value: "google" } });
    expect(handleChange).toHaveBeenCalledWith("google");

    // Clicking trigger opens Vision Portal popover mounted into document.body
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    const popover = screen.getByTestId("vision-select-popover");
    expect(popover).toBeInTheDocument();
    expect(popover.parentElement).toBe(document.body);
    expect(popover.className).toContain("vision-select-popover");
    expect(popover).toHaveTextContent("AI 大语言模型");
    expect(popover).toHaveTextContent("通用在线翻译");

    // Clicking option in Portal invokes onChange and closes popover
    const deepseekBtn = popover.querySelectorAll("button");
    const targetBtn = Array.from(deepseekBtn).find((b) =>
      b.textContent?.includes("DeepSeek")
    )!;
    fireEvent.click(targetBtn);

    expect(handleChange).toHaveBeenCalledWith("deepseek");
    expect(screen.queryByTestId("vision-select-popover")).toBeNull();
  });

  it("closes Portal popover on Escape key without leaking", () => {
    render(
      <GlassSelect
        value="ctrl"
        options={[
          { value: "ctrl", label: "Ctrl" },
          { value: "alt", label: "Alt" },
        ]}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("vision-select-popover")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("vision-select-popover")).toBeNull();
  });

  it("SnippingToolbar uses unified Vision GlassSelect Portal for target language and engine switcher", () => {
    const onSelectEngine = vi.fn();
    render(
      <SnippingToolbar
        activeTool={null}
        onSelectTool={vi.fn()}
        onTranslate={vi.fn()}
        onOcr={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPin={vi.fn()}
        isPinned={false}
        onSave={vi.fn()}
        onCopy={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        targetLang="auto"
        selectedEngine="auto"
        onSelectEngine={onSelectEngine}
      />
    );

    // Hidden combobox shims preserve title lookups for compatibility
    const langSelect = screen.getByTitle("切换目标语种");
    const engineSelect = screen.getByTitle("切换翻译引擎 (Tab)");
    expect(langSelect.className).toContain("sr-only");
    expect(engineSelect.className).toContain("sr-only");

    // Clicking the visible engine GlassSelect trigger opens a Portal popover with groups
    const engineTrigger = engineSelect.parentElement?.querySelector("button");
    expect(engineTrigger).toBeTruthy();
    fireEvent.click(engineTrigger!);

    const popover = screen.getByTestId("vision-select-popover");
    expect(popover.parentElement).toBe(document.body);
    expect(popover).toHaveTextContent("🤖 智能极速");

    const googleBtn = Array.from(popover.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Google")
    );
    expect(googleBtn).toBeTruthy();
    fireEvent.click(googleBtn!);
    expect(onSelectEngine).toHaveBeenCalledWith("google");
  });
});
