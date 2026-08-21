import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { AiChatPanel } from '../components/MainWindow/AiChatPanel';
import type { AppSettings } from '../services/types';
import * as tauriService from '../services/tauri';

describe('AiChatPanel Component and Interaction Test Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders correctly with model information and prompt presets', () => {
    render(<AiChatPanel />);

    expect(screen.getByText('AI 智能对话')).toBeTruthy();
    expect(screen.getAllByText('AI 智能翻译').length).toBeGreaterThan(0);
    expect(screen.getAllByText('学术润色').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CG 术语详解').length).toBeGreaterThan(0);
    expect(screen.getAllByText('代码注释翻译').length).toBeGreaterThan(0);
    expect(screen.getAllByText('多语境重写').length).toBeGreaterThan(0);
  });

  it('warns when sending message with missing API Key for non-local endpoints', async () => {
    const customSettings: AppSettings = {
      ...useSettingsStore.getState().settings,
      llmConfig: {
        provider: 'Custom',
        apiKey: '',
        model: 'gemini-3.5-flash-lite',
        endpoint: 'https://generativelanguage.googleapis.com',
      },
    };
    act(() => {
      useSettingsStore.setState({ settings: customSettings });
    });

    const openSettingsMock = vi.fn();
    render(<AiChatPanel onOpenSettings={openSettingsMock} />);

    // Warning in header
    expect(screen.getByText('⚠️ 未配置 Key')).toBeTruthy();

    // Type a message in the input box
    const textarea = screen.getByPlaceholderText(/输入翻译需求/);
    fireEvent.change(textarea, { target: { value: '你好，测试问题' } });

    const sendBtn = screen.getByText('发送');
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    // Should display missing API Key error alert
    expect(screen.getByText(/未配置 Custom 的 API 密钥/)).toBeTruthy();
  });

  it('allows sending chat messages and rendering replies when configured', async () => {
    const streamSpy = vi.spyOn(tauriService, 'cmdChatLlmStream').mockImplementation(async (_msgs, _cfg, onDelta) => {
      onDelta('你好！');
      onDelta('这是 AI 回复。');
      return '你好！这是 AI 回复。';
    });

    const customSettings: AppSettings = {
      ...useSettingsStore.getState().settings,
      llmConfig: {
        provider: 'DeepSeek',
        apiKey: 'sk-mock-key-12345',
        model: 'deepseek-chat',
        endpoint: 'https://api.deepseek.com/v1',
      },
    };
    act(() => {
      useSettingsStore.setState({ settings: customSettings });
    });

    render(<AiChatPanel />);

    const textarea = screen.getByPlaceholderText(/输入翻译需求/);
    fireEvent.change(textarea, { target: { value: '请问什么是法线贴图？' } });

    const sendBtn = screen.getByText('发送');
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      expect(streamSpy).toHaveBeenCalled();
      expect(screen.getByText(/这是 AI 回复/)).toBeTruthy();
    });
  });

  it('allows model switching in header dropdown when multiple models are available', async () => {
    const customSettings: AppSettings = {
      ...useSettingsStore.getState().settings,
      llmConfig: {
        id: 'deepseek-1',
        provider: 'DeepSeek',
        apiKey: 'sk-deepseek',
        model: 'deepseek-chat',
        endpoint: 'https://api.deepseek.com/v1',
      },
      llmConfigs: [
        {
          id: 'deepseek-1',
          provider: 'DeepSeek',
          apiKey: 'sk-deepseek',
          model: 'deepseek-chat',
          endpoint: 'https://api.deepseek.com/v1',
        },
        {
          id: 'ollama-1',
          provider: 'Ollama',
          apiKey: '',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
        },
        {
          id: 'unconfigured-1',
          provider: 'Zhipu GLM',
          apiKey: '',
          model: 'glm-4-flash',
          endpoint: 'https://open.bigmodel.cn/api/paas/v4',
        },
      ],
    };
    act(() => {
      useSettingsStore.setState({ settings: customSettings });
    });

    render(<AiChatPanel />);

    const select = screen.getByTitle('快速切换当前对话所使用的大模型') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('deepseek-1');

    // Unconfigured model must NOT be in options
    expect(screen.queryByText(/Zhipu GLM/)).toBeNull();

    // Configured models must be present
    expect(screen.getByText('Ollama (llama3)')).toBeTruthy();

    act(() => {
      fireEvent.change(select, { target: { value: 'ollama-1' } });
    });

    expect(useSettingsStore.getState().settings.llmConfig?.model).toBe('llama3');
  });

  it('automatically applies AI 智能翻译 prompt directive when AI 智能翻译 preset mode is activated', async () => {
    let sentMessages: { role: string; content: string }[] = [];
    vi.spyOn(tauriService, 'cmdChatLlmStream').mockImplementation(async (msgs, _cfg, onDelta) => {
      sentMessages = msgs;
      onDelta('翻译结果：这是次表面散射。');
      return '翻译结果：这是次表面散射。';
    });

    const customSettings: AppSettings = {
      ...useSettingsStore.getState().settings,
      llmConfig: {
        provider: 'DeepSeek',
        apiKey: 'sk-mock-key-12345',
        model: 'deepseek-chat',
        endpoint: 'https://api.deepseek.com/v1',
      },
    };
    act(() => {
      useSettingsStore.setState({ settings: customSettings });
    });

    render(<AiChatPanel />);

    // Click the top "AI 智能翻译" pill button to activate the mode
    const translateBtns = screen.getAllByText('AI 智能翻译');
    fireEvent.click(translateBtns[0]);

    // Expect mode indicator banner and language select
    expect(screen.getByText('【AI 智能翻译】')).toBeTruthy();
    expect(screen.getByTitle('选择 AI 对话翻译的目标语言')).toBeTruthy();

    // Type a simple raw sentence without prompt prefix
    const textarea = screen.getByPlaceholderText(/已开启 AI 智能翻译模式/);
    fireEvent.change(textarea, { target: { value: 'subsurface scattering' } });

    const sendBtn = screen.getByText('发送');
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      expect(sentMessages.length).toBeGreaterThan(0);
      const lastUserMsg = sentMessages[sentMessages.length - 1];
      expect(lastUserMsg.content).toContain('请作为资深专业翻译专家');
      expect(lastUserMsg.content).toContain('subsurface scattering');
      expect(screen.getByText(/这是次表面散射/)).toBeTruthy();
      expect(screen.getAllByText(/AI 智能翻译/).length).toBeGreaterThan(0);
    });
  });

  it('supports selecting custom target language in AI 智能翻译 mode (e.g. 日语)', async () => {
    let sentMessages: { role: string; content: string }[] = [];
    vi.spyOn(tauriService, 'cmdChatLlmStream').mockImplementation(async (msgs, _cfg, onDelta) => {
      sentMessages = msgs;
      onDelta('サブサーフェス・スキャッタリング');
      return 'サブサーフェス・スキャッタリング';
    });

    const customSettings: AppSettings = {
      ...useSettingsStore.getState().settings,
      llmConfig: {
        provider: 'DeepSeek',
        apiKey: 'sk-mock-key-12345',
        model: 'deepseek-chat',
        endpoint: 'https://api.deepseek.com/v1',
      },
    };
    act(() => {
      useSettingsStore.setState({ settings: customSettings });
    });

    render(<AiChatPanel />);

    // Activate AI translation mode
    const translateBtns = screen.getAllByText('AI 智能翻译');
    fireEvent.click(translateBtns[0]);

    // Select Japanese as target language
    const langSelect = screen.getByTitle('选择 AI 对话翻译的目标语言');
    fireEvent.change(langSelect, { target: { value: 'ja' } });

    // Verify textarea placeholder reflects Japanese
    const textarea = screen.getByPlaceholderText(/译为 日语/);
    fireEvent.change(textarea, { target: { value: '材质着色器' } });

    const sendBtn = screen.getByText('发送');
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      expect(sentMessages.length).toBeGreaterThan(0);
      const lastUserMsg = sentMessages[sentMessages.length - 1];
      expect(lastUserMsg.content).toContain('翻译为【🇯🇵 日语 (日本語)】');
      expect(lastUserMsg.content).toContain('材质着色器');
      expect(screen.getByText(/サブサーフェス・スキャッタリング/)).toBeTruthy();
      expect(screen.getAllByText(/AI 翻译 → 日语/).length).toBeGreaterThan(0);
    });
  });
});
