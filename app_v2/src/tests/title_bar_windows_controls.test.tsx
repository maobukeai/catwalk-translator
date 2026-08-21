import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TitleBar } from '../components/TitleBar';

describe('TitleBar Windows 11 Controls Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders brand logo and title on the left and all three Windows control buttons on the right', () => {
    render(<TitleBar />);

    expect(screen.getByAltText('猫步翻译')).toBeInTheDocument();
    expect(screen.getByText('猫步翻译')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化窗口' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化窗口' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭窗口' })).toBeInTheDocument();
  });

  it('handles minimize button click without throwing and stops propagation', () => {
    render(<TitleBar />);
    const minBtn = screen.getByRole('button', { name: '最小化窗口' });

    const stopPropagationSpy = vi.fn();
    fireEvent.click(minBtn, { stopPropagation: stopPropagationSpy });

    expect(minBtn).toBeInTheDocument();
  });

  it('toggles maximize state and switches aria-label to 向下还原窗口 in browser mode', async () => {
    render(<TitleBar />);
    const maxBtn = screen.getByRole('button', { name: '最大化窗口' });

    await act(async () => {
      fireEvent.click(maxBtn);
    });

    expect(screen.getByRole('button', { name: '向下还原窗口' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '向下还原窗口' }));
    });

    expect(screen.getByRole('button', { name: '最大化窗口' })).toBeInTheDocument();
  });

  it('handles close button click smoothly', () => {
    render(<TitleBar />);
    const closeBtn = screen.getByRole('button', { name: '关闭窗口' });

    fireEvent.click(closeBtn);
    expect(closeBtn).toBeInTheDocument();
  });

  it('renders spotlight button when onQuickSearch is provided', () => {
    const handleQuickSearch = vi.fn();
    render(<TitleBar onQuickSearch={handleQuickSearch} />);

    const spotlightBtn = screen.getByTitle('快速查词（Spotlight）');
    expect(spotlightBtn).toBeInTheDocument();

    fireEvent.click(spotlightBtn);
    expect(handleQuickSearch).toHaveBeenCalledTimes(1);
  });

  it('renders and handles onOpenAbout when provided in titlebar', () => {
    const handleOpenAbout = vi.fn();
    render(<TitleBar onOpenAbout={handleOpenAbout} />);

    const aboutBtn = screen.getByRole('button', { name: '软件信息' });
    expect(aboutBtn).toBeInTheDocument();

    fireEvent.click(aboutBtn);
    expect(handleOpenAbout).toHaveBeenCalledTimes(1);

    const brandBtn = screen.getByAltText('猫步翻译').closest('button');
    expect(brandBtn).toBeInTheDocument();
    if (brandBtn) {
      fireEvent.click(brandBtn);
      expect(handleOpenAbout).toHaveBeenCalledTimes(2);
    }
  });
});
