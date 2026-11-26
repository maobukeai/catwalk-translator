import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SearchPanel } from '../components/MainWindow/SearchPanel';
import { SpotlightModal } from '../components/SpotlightModal';
import { DEFAULT_SETTINGS } from '../services/defaultSettings';
import * as tauriService from '../services/tauri';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { TextQueryResponse } from '../services/types';

describe('第 3 站方案 C：SearchPanel 语境副驾抽屉 & Spotlight 灵动胶囊测试', () => {
  const mockDetailResponse: TextQueryResponse = {
    original: 'Principled BSDF',
    wordDetail: {
      phoneticUs: '',
      phoneticUk: '',
      pos: 'Shader Node',
      definition: '原理化 BSDF 主着色器',
      examples: [
        'Connect roughness map to Principled BSDF.',
        '将粗糙度贴图连接至原理化 BSDF。',
      ],
      cgDomainNote: 'CG 材质 [BLENDER]',
    },
    results: [
      {
        engineName: 'Blender 内置词典',
        translated: '原理化 BSDF (主着色器)',
        sourceTier: 'Preset Dictionary',
      },
      {
        engineName: 'Google 翻译',
        translated: '原理图 BSDF',
        sourceTier: 'Online Fallback',
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('SearchPanel 方案 C 支持折叠与重新展开右侧 AI 语境副驾抽屉，且保留主词头与多源对照', async () => {
    vi.spyOn(tauriService, 'cmdQueryText').mockResolvedValue(mockDetailResponse);
    vi.spyOn(tauriService, 'cmdGetHistory').mockResolvedValue([]);
    vi.spyOn(tauriService, 'cmdAddHistory').mockResolvedValue();

    render(<SearchPanel settings={DEFAULT_SETTINGS} />);

    // 点击常用术语快捷标签即查
    fireEvent.click(screen.getByRole('button', { name: 'Principled BSDF' }));

    await waitFor(() => {
      expect(screen.getByText('原理化 BSDF 主着色器')).toBeInTheDocument();
    });

    // 右侧 AI 语境副驾抽屉默认展示
    expect(screen.getByTestId('search-ai-copilot-drawer')).toBeInTheDocument();
    expect(screen.getByText('多通道引擎对照结果 (2)')).toBeInTheDocument();

    // 收起抽屉
    fireEvent.click(screen.getByTestId('search-ai-drawer-toggle'));
    expect(screen.queryByTestId('search-ai-copilot-drawer')).toBeNull();
    expect(screen.getByText('原理化 BSDF 主着色器')).toBeInTheDocument();
    expect(screen.getByText('多通道引擎对照结果 (2)')).toBeInTheDocument();

    // 重新展开抽屉
    fireEvent.click(screen.getByTestId('search-ai-drawer-toggle'));
    expect(screen.getByTestId('search-ai-copilot-drawer')).toBeInTheDocument();
  });

  it('SpotlightModal 方案 C 未查词呈单行灵动胶囊，点击热词后弹性展开并支持收藏与复制', async () => {
    vi.spyOn(tauriService, 'cmdGetHistory').mockResolvedValue([]);
    vi.spyOn(tauriService, 'cmdQueryText').mockResolvedValue(mockDetailResponse);
    vi.spyOn(tauriService, 'cmdAddHistory').mockResolvedValue();
    vi.spyOn(tauriService, 'cmdToggleFavorite').mockResolvedValue(true);

    const handleClose = vi.fn();
    render(<SpotlightModal isOpen={true} onClose={handleClose} settings={DEFAULT_SETTINGS} />);

    // 初始为收起的单行 rounded-full 灵动胶囊与快速热词条
    const shell = screen.getByTestId('spotlight-shell');
    expect(shell.className).toContain('rounded-full');
    const chipsWrap = screen.getByTestId('spotlight-quick-chips');
    expect(chipsWrap).toBeInTheDocument();

    // 点击热词标签触发展开查词
    fireEvent.click(screen.getByRole('button', { name: 'Principled BSDF' }));

    await waitFor(() => {
      expect(screen.getByText('原理化 BSDF 主着色器')).toBeInTheDocument();
    });

    expect(screen.getByTestId('spotlight-shell').className).toContain('rounded-[24px]');
    expect(screen.queryByTestId('spotlight-quick-chips')).toBeNull();
    expect(screen.queryByText(/^美\s*$/)).toBeNull();
    expect(screen.queryByText(/^英\s*$/)).toBeNull();

    // 收藏与复制按钮可正常响应
    fireEvent.click(screen.getByTestId('spotlight-fav-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('spotlight-fav-btn')).toHaveAttribute('title', '已加入生词本');
    });

    const copyBtn = screen.getAllByTitle('复制译文')[0];
    fireEvent.click(copyBtn);
    expect(screen.getByText('多源对照 (2)')).toBeInTheDocument();
  });

  it('cmdQueryText 默认携带 skipLlm=true（即使已配置大模型），避免卡在 15s 同步等待', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    createMockIpcHarness();
    try {
      await tauriService.cmdQueryText('那个', 'blender', {
        id: 'llm-1',
        provider: 'DeepSeek',
        model: 'deepseek-chat',
        apiKey: 'sk-test-key',
        endpoint: 'https://api.deepseek.com/v1',
        enabled: true,
      });
      const harness = getActiveHarness()!;
      const univCall = harness.state.invokedCommands.find(
        (c) => c.cmd === 'cmd_universal_translate'
      );
      expect(univCall).toBeDefined();
      expect(univCall?.args?.req?.skipLlm).toBe(true);
    } finally {
      delete (window as any).__TAURI_INTERNALS__;
    }
  });

  it('SearchPanel 查词时优先通过 Stage-0 闪电快通道毫秒上屏，随后平滑升级完整词典与多源结果', async () => {
    vi.spyOn(tauriService, 'cmdGetHistory').mockResolvedValue([]);
    vi.spyOn(tauriService, 'cmdAddHistory').mockResolvedValue();
    vi.spyOn(tauriService, 'cmdTranslatePhrasesStyled').mockResolvedValue([
      {
        original: '那个',
        translated: 'that one (⚡)',
        sourceTier: 'Bing Edge ⚡',
      },
    ]);
    vi.spyOn(tauriService, 'cmdQueryText').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 80));
      return {
        original: '那个',
        wordDetail: {
          phoneticUs: '',
          phoneticUk: '',
          pos: '常用词条 / 表达',
          definition: 'that one (full)',
          examples: [],
          cgDomainNote: '多源对照 [BLENDER]',
        },
        results: [
          {
            engineName: 'Google 翻译',
            translated: 'that one (full)',
            sourceTier: 'Online Fallback',
          },
        ],
      };
    });

    render(<SearchPanel settings={DEFAULT_SETTINGS} />);

    const input = screen.getByPlaceholderText(/输入词条、CG 材质术语或短语/);
    fireEvent.change(input, { target: { value: '那个' } });
    fireEvent.click(screen.getByRole('button', { name: /查询词条/ }));

    // Stage-0 闪电快通道先秒出上屏
    await waitFor(() => {
      expect(screen.getAllByText('that one (⚡)').length).toBeGreaterThanOrEqual(1);
    });

    // Stage-1 完整结果到达后无缝升级
    await waitFor(() => {
      expect(screen.getAllByText('that one (full)').length).toBeGreaterThanOrEqual(1);
    });
  });
});
