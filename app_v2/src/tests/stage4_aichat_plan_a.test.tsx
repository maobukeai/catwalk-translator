import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AiChatPanel } from '../components/MainWindow/AiChatPanel';
import { useSettingsStore } from '../stores/useSettingsStore';
import * as tauriService from '../services/tauri';

vi.mock('../services/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/tauri')>();
  return {
    ...actual,
    cmdChatLlmStream: vi.fn(),
    cmdChatLlm: vi.fn(),
  };
});

describe('Stage 4 Plan A: AiChatPanel Vision 对话舱升级回归', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        llmConfig: {
          provider: 'SenseNova',
          apiKey: 'test-api-key',
          model: 'sensenova-6.8-flash-lite',
          endpoint: 'https://token.sensenova.cn/v1',
        },
        llmConfigs: [
          {
            provider: 'SenseNova',
            apiKey: 'test-api-key',
            model: 'sensenova-6.8-flash-lite',
            endpoint: 'https://token.sensenova.cn/v1',
          },
        ],
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders fenced code blocks and inline code cleanly, and handles code copy without clipboard API errors', async () => {
    const mockStream = vi.mocked(tauriService.cmdChatLlmStream);
    mockStream.mockResolvedValueOnce(
      '可参考 `normalize` 节点与下方代码：\n```hlsl\nfloat3 n = normalize(vNormal);\n```\n完成。'
    );

    render(<AiChatPanel />);
    const textarea = screen.getByPlaceholderText(/输入翻译需求/);
    fireEvent.change(textarea, { target: { value: '给个法线归一化示例' } });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));

    await waitFor(() => {
      expect(screen.getByText('hlsl')).toBeInTheDocument();
    });
    expect(screen.getByText('normalize')).toBeInTheDocument();
    expect(screen.getByText('float3 n = normalize(vNormal);')).toBeInTheDocument();

    const copyCodeBtn = screen.getByTitle('复制代码片段');
    expect(() => fireEvent.click(copyCodeBtn)).not.toThrow();
    expect(screen.getByText('已复制')).toBeInTheDocument();
  });

  it('exports markdown inline with 已导出 feedback instead of blocking window.alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const mockStream = vi.mocked(tauriService.cmdChatLlmStream);
    mockStream.mockResolvedValueOnce('这是导出测试回复');

    render(<AiChatPanel />);
    const textarea = screen.getByPlaceholderText(/输入翻译需求/);
    fireEvent.change(textarea, { target: { value: '导出测试' } });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));

    await waitFor(() => {
      expect(screen.getByText('这是导出测试回复')).toBeInTheDocument();
    });

    const exportBtn = screen.getByTitle('将当前完整对话复制为 Markdown 格式');
    fireEvent.click(exportBtn);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByText('已导出')).toBeInTheDocument();
  });

  it('uses slide-over glass history drawer without duplicate permanent sidebar aside', async () => {
    localStorage.setItem(
      'maobu_chat_sessions_v1',
      JSON.stringify([
        {
          id: 'sess_1',
          title: 'Subsurface 参数测试',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [
            { id: 'u1', role: 'user', content: '什么是 Subsurface？', timestamp: '10:00' },
          ],
        },
      ])
    );

    const { container } = render(<AiChatPanel />);
    expect(container.querySelector('aside')).toBeNull();

    fireEvent.click(screen.getByTitle('查看与管理历史对话记录'));
    const drawer = screen.getByTestId('chat-history-drawer');
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByText('Subsurface 参数测试')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('关闭抽屉'));
    expect(screen.queryByTestId('chat-history-drawer')).not.toBeInTheDocument();
  });

  it('integrates preset pills and context switch into the bottom Vision composer and toggles collapse cleanly', () => {
    render(<AiChatPanel />);
    const composer = screen.getByTestId('chat-composer-shell');

    expect(within(composer).getByText('AI 智能翻译')).toBeInTheDocument();
    expect(within(composer).getByText('CG 术语详解')).toBeInTheDocument();
    expect(within(composer).getByText('连续对话')).toBeInTheDocument();

    fireEvent.click(screen.getByText('收起预设'));
    expect(within(composer).queryByText('连续对话')).not.toBeInTheDocument();
    expect(screen.getByText('连续')).toBeInTheDocument();
  });
});
