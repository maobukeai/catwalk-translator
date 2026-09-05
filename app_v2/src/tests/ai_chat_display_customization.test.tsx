import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { AiChatPanel } from '../components/MainWindow/AiChatPanel';

describe('AiChatPanel Display Customization Test Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders font size controls and toggles between small, medium, and large with persistence', () => {
    render(<AiChatPanel />);

    const smallBtn = screen.getByTitle(/紧凑小字/);
    const mediumBtn = screen.getByTitle(/标准字号/);
    const largeBtn = screen.getByTitle(/舒适大字/);

    expect(smallBtn).toBeTruthy();
    expect(mediumBtn).toBeTruthy();
    expect(largeBtn).toBeTruthy();

    // Default is medium
    expect(localStorage.getItem('maobu_chat_fontsize_v1')).toBeNull();

    // Switch to small
    act(() => {
      fireEvent.click(smallBtn);
    });
    expect(localStorage.getItem('maobu_chat_fontsize_v1')).toBe('small');

    // Switch to large
    act(() => {
      fireEvent.click(largeBtn);
    });
    expect(localStorage.getItem('maobu_chat_fontsize_v1')).toBe('large');

    // Switch back to medium
    act(() => {
      fireEvent.click(mediumBtn);
    });
    expect(localStorage.getItem('maobu_chat_fontsize_v1')).toBe('medium');

    // Verify tooltips contain enhanced font size scale
    expect(smallBtn.getAttribute('title')).toContain('12px');
    expect(mediumBtn.getAttribute('title')).toContain('14.5px');
    expect(largeBtn.getAttribute('title')).toContain('17.5px');
  });

  it('toggles compact density mode and persists to localStorage', () => {
    render(<AiChatPanel />);

    // Initially standard/comfortable
    const toggleDensityBtn = screen.getByTitle(/当前为标准舒适模式/);
    expect(toggleDensityBtn).toBeTruthy();
    expect(screen.getByText('舒适')).toBeTruthy();

    // Toggle to compact
    act(() => {
      fireEvent.click(toggleDensityBtn);
    });
    expect(localStorage.getItem('maobu_chat_density_v1')).toBe('compact');
    expect(screen.getByText('紧凑')).toBeTruthy();

    // Toggle back to normal
    act(() => {
      fireEvent.click(toggleDensityBtn);
    });
    expect(localStorage.getItem('maobu_chat_density_v1')).toBe('normal');
    expect(screen.getByText('舒适')).toBeTruthy();
  });

  it('toggles presets bar visibility and persists to localStorage', () => {
    render(<AiChatPanel />);

    // Initially presets row is visible
    const foldBtn = screen.getByTitle(/折叠快捷翻译与润色预设栏/);
    expect(foldBtn).toBeTruthy();
    expect(screen.getByText('收起预设')).toBeTruthy();

    // Fold presets
    act(() => {
      fireEvent.click(foldBtn);
    });
    expect(localStorage.getItem('maobu_chat_show_presets_v1')).toBe('false');
    expect(screen.getByText('快捷预设')).toBeTruthy();

    // When presets are folded, the 连续/单轮 button is still available in header
    expect(screen.getByTitle(/已开启连续上下文记忆/)).toBeTruthy();

    // Expand presets again
    act(() => {
      fireEvent.click(screen.getByText('快捷预设'));
    });
    expect(localStorage.getItem('maobu_chat_show_presets_v1')).toBe('true');
    expect(screen.getByText('收起预设')).toBeTruthy();
  });
});
