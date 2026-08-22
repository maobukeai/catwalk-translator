import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PinWindowApp } from '../components/Pin/PinWindow';

const MOCK_PAYLOAD = {
  id: 'pin_test_1',
  title: '划词译文',
  blocks: [
    { original: 'Roughness', translated: '粗糙度', sourceTier: 'Preset (Blender)' },
    { original: 'Subsurface Scattering', translated: '次表面散射', sourceTier: 'LLM API' },
  ],
  x: 100,
  y: 100,
  width: 380,
  height: 260,
};

vi.mock('../services/tauri', () => ({
  isTauri: () => false,
  cmdGetPinPayload: vi.fn(async () => MOCK_PAYLOAD),
  cmdClosePin: vi.fn(async () => undefined),
}));

// 浏览器模式下组件不订阅事件/不调窗口 API，无需 mock @tauri-apps

describe('PinWindow 贴图窗口', () => {
  beforeEach(() => {
    window.location.hash = '#pin=pin_test_1';
  });
  afterEach(() => {
    cleanup();
    window.location.hash = '';
    vi.clearAllMocks();
  });

  it('加载并渲染贴图内容块', async () => {
    render(<PinWindowApp />);
    expect(await screen.findByText('粗糙度')).toBeInTheDocument();
    expect(screen.getByText('次表面散射')).toBeInTheDocument();
    expect(screen.getByText('Roughness')).toBeInTheDocument();
    expect(screen.getByText(/Preset \(Blender\)/)).toBeInTheDocument();
  });

  it('折叠按钮收起内容区，展开后恢复', async () => {
    render(<PinWindowApp />);
    await screen.findByText('粗糙度');

    fireEvent.click(screen.getByTestId('pin-collapse'));
    // 折叠态：内容块隐藏，标题显示段数摘要
    expect(screen.queryByText('Roughness')).not.toBeInTheDocument();
    expect(screen.getByText(/2 段/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pin-collapse'));
    expect(await screen.findByText('Roughness')).toBeInTheDocument();
  });

  it('复制按钮把全部译文写入剪贴板', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<PinWindowApp />);
    fireEvent.click(await screen.findByTitle('复制全部译文'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('粗糙度\n次表面散射');
    });
    expect(await screen.findByText('已复制')).toBeInTheDocument();
  });
});
