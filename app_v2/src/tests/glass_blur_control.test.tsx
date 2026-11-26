import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import App from '../App';
import { useSettingsStore } from '../stores/useSettingsStore';

vi.mock('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
  once: async () => {},
  emit: async () => {},
  emitTo: async () => {},
  TauriEvent: {},
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    label: 'main',
    isMaximized: async () => false,
    toggleMaximize: async () => {},
    minimize: async () => {},
    hide: async () => {},
    close: async () => {},
    startDragging: async () => {},
  }),
}));

describe('全局磨砂玻璃开关与 0~40px 实时模糊联动', () => {
  beforeEach(() => {
    localStorage.setItem('catwalk_onboarding_v1', '1');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__;
  });

  it('0px 为清晰透视 (data-glass=clear)、关闭开关为纯色 (data-glass=off)、27~40px 随滑杆同步递增底色透明度', async () => {
    createMockIpcHarness();
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async () => 0,
      transformCallback: () => 0,
      unregisterCallback: () => {},
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
    const harness = getActiveHarness()!;

    const { container } = render(<App />);

    // 1. 设为开启磨砂 + 27px
    act(() => {
      useSettingsStore.getState().setAppearance({ theme: 'light', enableBlur: true, blurAmount: 27 });
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.glass).toBe('frosted');
      expect(document.documentElement.style.getPropertyValue('--glass-blur')).toBe('27px');
    });

    const rootEl = container.firstElementChild as HTMLElement;
    const alphaAt27 = parseFloat(rootEl.style.backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/)?.[1] ?? '0');

    // 2. 拉满到 40px，窗口透明度（遮罩浓度）应明显提高且 DWM 模糊开启
    act(() => {
      useSettingsStore.getState().setBlurAmount(40);
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.glass).toBe('frosted');
      expect(document.documentElement.style.getPropertyValue('--glass-blur')).toBe('40px');
    });
    const alphaAt40 = parseFloat(rootEl.style.backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/)?.[1] ?? '0');
    expect(alphaAt40).toBeGreaterThan(alphaAt27);

    // 3. 拉到 0px（清晰透视），不能退化成不透明纯色，且通知 Rust 关闭 DWM 模糊
    act(() => {
      useSettingsStore.getState().setBlurAmount(0);
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.glass).toBe('clear');
      expect(document.documentElement.style.getPropertyValue('--glass-blur')).toBe('0px');
      const blurCalls = (harness.invokeMock.mock.calls as any[]).filter((c) => c[0] === 'cmd_set_window_blur');
      expect(blurCalls[blurCalls.length - 1]?.[1]).toEqual({ enable: false, isDark: false });
    });
    const alphaAt0 = parseFloat(rootEl.style.backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/)?.[1] ?? '1');
    expect(alphaAt0).toBeLessThan(alphaAt27);

    // 4. 关闭「开启背景磨砂玻璃材质」开关 -> 切换为实底纯色 off
    act(() => {
      useSettingsStore.getState().setEnableBlur(false);
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.glass).toBe('off');
      expect(rootEl.style.backdropFilter).toBe('none');
    });

    // 恢复默认设置避免污染后续套件
    act(() => {
      useSettingsStore.getState().setAppearance({ theme: 'system', enableBlur: true, blurAmount: 24 });
    });
  });
});
