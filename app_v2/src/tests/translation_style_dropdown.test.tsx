import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TranslationStyleDropdown } from "../components/MainWindow/TranslationStyleDropdown";

describe("TranslationStyleDropdown Component", () => {
  it("renders currently selected style correctly", () => {
    render(<TranslationStyleDropdown value="literal" onChange={vi.fn()} />);
    expect(screen.getByText("直译")).toBeInTheDocument();
  });

  it("opens popover menu when clicked and shows all options with descriptions", () => {
    render(<TranslationStyleDropdown value="free" onChange={vi.fn()} />);
    const trigger = screen.getByText("流畅");
    fireEvent.click(trigger);

    expect(screen.getByText("译文风格 / Style")).toBeInTheDocument();
    expect(screen.getByText("直译")).toBeInTheDocument();
    expect(screen.getByText("紧扣原文，严谨对照")).toBeInTheDocument();
    expect(screen.getByText("地道通顺，自然易读")).toBeInTheDocument();
    expect(screen.getByText("术语优先")).toBeInTheDocument();
    expect(screen.getByText("对齐 CG / 行业定名")).toBeInTheDocument();
  });

  it("calls onChange when an option is selected", () => {
    const handleChange = vi.fn();
    render(<TranslationStyleDropdown value="literal" onChange={handleChange} />);
    
    // Open menu
    fireEvent.click(screen.getByText("直译"));

    // Click "术语优先"
    const terminologyOption = screen.getByText("术语优先");
    fireEvent.click(terminologyOption);

    expect(handleChange).toHaveBeenCalledWith("terminology");
  });
});
