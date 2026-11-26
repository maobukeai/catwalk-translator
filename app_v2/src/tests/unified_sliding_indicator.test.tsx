import React, { useState } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSlidingIndicator } from "../hooks/useSlidingIndicator";
import { SlidingHighlight } from "../components/Common/SlidingHighlight";
import { AppearancePanel } from "../components/Settings/panels/AppearancePanel";
import { HotkeyPanel } from "../components/Settings/panels/HotkeyPanel";
import { SettingsDashboard } from "../components/Settings/SettingsDashboard";
import { useSettingsStore } from "../stores/useSettingsStore";
import { DEFAULT_SETTINGS } from "../services/defaultSettings";

const SlidingGridHarness: React.FC<{ initialKey: string | null }> = ({ initialKey }) => {
  const [active, setActive] = useState<string | null>(initialKey);
  const { containerRef, registerItem, rect, isReady } = useSlidingIndicator<HTMLDivElement>(active);

  return (
    <div>
      <div
        ref={(el) => {
          containerRef.current = el;
          if (el) {
            el.getBoundingClientRect = () =>
              ({ left: 100, top: 200, width: 320, height: 120, right: 420, bottom: 320, x: 100, y: 200, toJSON: () => ({}) } as DOMRect);
          }
        }}
        data-testid="harness-container"
        className="relative"
      >
        <SlidingHighlight rect={rect} isReady={isReady} variant="card" testId="harness-slider" />
        {[
          { id: "a", l: 110, t: 210, w: 90, h: 40 },
          { id: "b", l: 210, t: 210, w: 90, h: 40 },
          { id: "c", l: 110, t: 260, w: 90, h: 40 },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`opt-${item.id}`}
            ref={(el) => {
              registerItem(item.id)(el);
              if (el) {
                el.getBoundingClientRect = () =>
                  ({
                    left: item.l,
                    top: item.t,
                    width: item.w,
                    height: item.h,
                    right: item.l + item.w,
                    bottom: item.t + item.h,
                    x: item.l,
                    y: item.t,
                    toJSON: () => ({}),
                  } as DOMRect);
              }
            }}
            onClick={() => setActive(item.id)}
          >
            {item.id}
          </button>
        ))}
        <button type="button" data-testid="clear-opt" onClick={() => setActive(null)}>
          clear
        </button>
      </div>
    </div>
  );
};

describe("Universal 2D Sliding Indicator System", () => {
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

  it("computes exact 2D translate3d coordinates across rows and fades out when cleared", () => {
    render(<SlidingGridHarness initialKey="a" />);
    const slider = screen.getByTestId("harness-slider");
    expect(slider.className).toContain("vision-sliding-indicator");
    expect(slider).toHaveStyle({
      width: "90px",
      height: "40px",
      transform: "translate3d(10px, 10px, 0)",
      opacity: "1",
    });

    // Switch to item c on second row
    fireEvent.click(screen.getByTestId("opt-c"));
    expect(slider).toHaveStyle({
      transform: "translate3d(10px, 60px, 0)",
      opacity: "1",
    });

    // Clear selection fades indicator out cleanly
    fireEvent.click(screen.getByTestId("clear-opt"));
    expect(slider).toHaveStyle({ opacity: "0" });
  });

  it("mounts SlidingHighlight across AppearancePanel, HotkeyPanel, and SettingsDashboard", () => {
    render(<AppearancePanel />);
    expect(screen.getByTestId("appearance-theme-slider")).toHaveClass("vision-sliding-indicator");
    expect(screen.getByTestId("appearance-font-slider")).toHaveClass("vision-sliding-indicator");
    expect(screen.getByTestId("appearance-fontsize-slider")).toHaveClass("vision-sliding-indicator");

    render(<HotkeyPanel />);
    expect(screen.getByTestId("hotkey-release-slider")).toHaveClass("vision-sliding-indicator");

    render(<SettingsDashboard />);
    expect(screen.getByTestId("settings-nav-slider")).toHaveClass("vision-sliding-indicator");
  });
});
