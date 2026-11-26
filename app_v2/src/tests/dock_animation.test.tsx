import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Dock } from '../components/Dock';

describe('Dock 导航切换平移动画与指示器测试', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('渲染滑动滑块 .dock-indicator 并在切换 tab 时触发果冻拉伸与 onTabChange', () => {
    vi.useFakeTimers();
    const onTabChange = vi.fn();
    const { container, rerender } = render(
      <Dock
        activeTab="translate"
        onTabChange={onTabChange}
        onTriggerCapture={vi.fn()}
        onTriggerClipboard={vi.fn()}
        onTriggerSpotlight={vi.fn()}
        onOpenCheatSheet={vi.fn()}
      />
    );

    const indicator = container.querySelector('.dock-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator?.classList.contains('is-stretching')).toBe(false);

    // 验证滑块内部包含指示光条
    const dot = indicator?.querySelector('.dock-dot');
    expect(dot).toBeInTheDocument();

    // Dock 内不再渲染冗余 OCR 状态指示点
    expect(screen.queryByLabelText(/OCR 引擎状态/)).not.toBeInTheDocument();

    // 点击查词
    const searchBtn = screen.getByRole('button', { name: '查词' });
    fireEvent.click(searchBtn);
    expect(onTabChange).toHaveBeenCalledWith('search');

    // 模拟父级切换 activeTab 为 search，触发果冻拉伸态
    rerender(
      <Dock
        activeTab="search"
        onTabChange={onTabChange}
        onTriggerCapture={vi.fn()}
        onTriggerClipboard={vi.fn()}
        onTriggerSpotlight={vi.fn()}
        onOpenCheatSheet={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '查词' }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: '翻译器' }).getAttribute('data-active')).toBe('false');
    expect(indicator?.classList.contains('is-stretching')).toBe(true);

    // 140ms 后弹簧恢复正常尺寸
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(indicator?.classList.contains('is-stretching')).toBe(false);
  });

  it('鼠标在 Dock 上移动与移出时正确更新并复位磁力波浪 CSS 变量', () => {
    render(
      <Dock
        activeTab="translate"
        onTabChange={vi.fn()}
        onTriggerCapture={vi.fn()}
        onTriggerClipboard={vi.fn()}
        onTriggerSpotlight={vi.fn()}
        onOpenCheatSheet={vi.fn()}
      />
    );

    const nav = screen.getByRole('navigation', { name: '主导航' });
    const translateBtn = screen.getByRole('button', { name: '翻译器' });

    fireEvent.mouseMove(nav, { clientX: 20 });
    expect(translateBtn.style.getPropertyValue('--mag-scale')).not.toBe('');
    expect(translateBtn.style.getPropertyValue('--mag-ty')).not.toBe('');

    fireEvent.mouseLeave(nav);
    expect(translateBtn.style.getPropertyValue('--mag-scale')).toBe('1');
    expect(translateBtn.style.getPropertyValue('--mag-ty')).toBe('0px');
  });
});
