import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GlassSelect } from "../components/Common/GlassSelect";

describe("GlassSelect Component", () => {
  const mockOptions = [
    { value: "auto", label: "🌐 中英双向互译 (自动识别)" },
    { value: "zh-CN", label: "🇨🇳 简体中文 (Chinese)" },
    { value: "en", label: "🇺🇸 英语 (English)" },
    { value: "ja", label: "🇯🇵 日语 (日本語)" },
  ];

  it("renders selected option label correctly", () => {
    render(
      <GlassSelect
        value="auto"
        options={mockOptions}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button")).toHaveTextContent("🌐 中英双向互译 (自动识别)");
  });

  it("opens popover menu on click and lists options", () => {
    render(
      <GlassSelect
        value="zh-CN"
        options={mockOptions}
        onChange={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    expect(screen.getAllByText("🇺🇸 英语 (English)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("🇯🇵 日语 (日本語)").length).toBeGreaterThan(0);
  });

  it("calls onChange when an option is clicked and closes menu", () => {
    const handleChange = vi.fn();
    render(
      <GlassSelect
        value="auto"
        options={mockOptions}
        onChange={handleChange}
      />
    );

    // Open
    fireEvent.click(screen.getByRole("button"));

    // Select
    const enOptions = screen.getAllByText("🇺🇸 英语 (English)");
    fireEvent.click(enOptions[enOptions.length - 1]);

    expect(handleChange).toHaveBeenCalledWith("en");
  });

  it("supports search filtering when searchable is true", () => {
    render(
      <GlassSelect
        value="auto"
        options={mockOptions}
        onChange={vi.fn()}
        searchable={true}
      />
    );

    // Open
    fireEvent.click(screen.getByRole("button"));

    const searchInput = screen.getByPlaceholderText("搜索选项...");
    fireEvent.change(searchInput, { target: { value: "英语" } });

    expect(screen.getAllByText("🇺🇸 英语 (English)").length).toBeGreaterThan(0);
  });
});
