import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('AiChatPanel Full Suite', () => {
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
  });

  it('renders modern topbar actions: 历史, 新对话, 导出, 清空, 连续对话切换', () => {
    render(<AiChatPanel />);
    expect(screen.getByText(/历史/)).toBeInTheDocument();
    expect(screen.getByText('新对话')).toBeInTheDocument();
    expect(screen.getByText('导出')).toBeInTheDocument();
    expect(screen.getByText('清空')).toBeInTheDocument();
    expect(screen.getByText('连续对话')).toBeInTheDocument();
  });

  it('toggles context memory mode between 连续对话 and 单轮问答', () => {
    render(<AiChatPanel />);
    const contextBtn = screen.getByText('连续对话');
    fireEvent.click(contextBtn);
    expect(screen.getByText('单轮问答')).toBeInTheDocument();
    fireEvent.click(screen.getByText('单轮问答'));
    expect(screen.getByText('连续对话')).toBeInTheDocument();
  });

  it('opens and closes history drawer with empty state', () => {
    render(<AiChatPanel />);
    const historyBtn = screen.getByText(/历史/);
    fireEvent.click(historyBtn);
    expect(screen.getByText(/历史对话 \(/)).toBeInTheDocument();
    expect(screen.getByText('暂无历史对话记录')).toBeInTheDocument();

    const closeBtn = screen.getByTitle('关闭抽屉');
    fireEvent.click(closeBtn);
    expect(screen.queryByText('暂无历史对话记录')).not.toBeInTheDocument();
  });

  it('handles sending message and displays streaming reasoning and content', async () => {
    const mockStream = vi.mocked(tauriService.cmdChatLlmStream);
    mockStream.mockImplementation(async (_msgs, _llm, onDelta) => {
      onDelta('', '开始分析用户提问...');
      onDelta('你好！很高兴为您服务。', undefined);
      return '你好！很高兴为您服务。';
    });

    render(<AiChatPanel />);
    const textarea = screen.getByPlaceholderText(/输入翻译需求、多语种润色或任意问题/);
    fireEvent.change(textarea, { target: { value: '你好' } });

    const sendBtn = screen.getByRole('button', { name: /发送/ });
    fireEvent.click(sendBtn);

    expect(screen.getAllByText('你好').length).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      expect(screen.getByText('你好！很高兴为您服务。')).toBeInTheDocument();
    });

    // 回复完成后默认闭合思考过程，显示“展开思路”
    const expandBtn = screen.getByText('展开思路');
    expect(expandBtn).toBeInTheDocument();

    // 点击展开思路后，显示内部推导内容并切换为“收起思路”
    fireEvent.click(expandBtn);
    expect(screen.getByText('收起思路')).toBeInTheDocument();
    expect(screen.getByText(/开始分析用户提问/)).toBeInTheDocument();
  });

  it('renders user message action bar: 复制, 编辑, 删除', async () => {
    render(<AiChatPanel />);
    const textarea = screen.getByPlaceholderText(/输入翻译需求、多语种润色或任意问题/);
    fireEvent.change(textarea, { target: { value: '测试用户问题' } });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));

    expect(screen.getAllByText('测试用户问题').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTitle('复制提问')).toBeInTheDocument();
    expect(screen.getByTitle('填入输入框重新编辑')).toBeInTheDocument();
    expect(screen.getByTitle('删除此条提问')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('填入输入框重新编辑'));
    expect((textarea as HTMLTextAreaElement).value).toBe('测试用户问题');

    fireEvent.click(screen.getByTitle('删除此条提问'));
    expect(screen.queryByTitle('复制提问')).not.toBeInTheDocument();
  });
});
