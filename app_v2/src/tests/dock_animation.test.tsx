import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dock } from '../components/Dock';

describe('Dock 导航切换平移动画与指示器测试', () => {
  it('渲染滑动滑块 .dock-indicator 并在切换 tab 时触发 onTabChange', () => {
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

    // 验证滑块内部包含指示光点
    const dot = indicator?.querySelector('.dock-dot');
    expect(dot).toBeInTheDocument();

    // 点击查词
    const searchBtn = screen.getByRole('button', { name: '查词' });
    fireEvent.click(searchBtn);
    expect(onTabChange).toHaveBeenCalledWith('search');

    // 模拟父级切换 activeTab 为 search
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
  });
});
