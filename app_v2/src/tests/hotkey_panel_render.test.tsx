import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HotkeyPanel } from '../components/Settings/panels/HotkeyPanel';
import { useSettingsStore } from '../stores/useSettingsStore';
import { DEFAULT_SETTINGS } from '../services/defaultSettings';

describe('HotkeyPanel 快捷键控制中心渲染与交互测试', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
    });
  });

  it('完整渲染全部 4 个全局快捷键项（包含按键胶囊、重新录制、测试与开关）', () => {
    const onStartCapture = vi.fn();
    const onTriggerSpotlight = vi.fn();
    const onTriggerClipboard = vi.fn();
    const onToggleWindow = vi.fn();

    render(
      <HotkeyPanel
        onStartCapture={onStartCapture}
        onTriggerSpotlight={onTriggerSpotlight}
        onTriggerClipboard={onTriggerClipboard}
        onToggleWindow={onToggleWindow}
      />
    );

    // 验证 4 个功能名称全部存在
    expect(screen.getByText('全局划词选区')).toBeInTheDocument();
    expect(screen.getByText('Spotlight 居中查词')).toBeInTheDocument();
    expect(screen.getByText('剪贴板静默翻译')).toBeInTheDocument();
    expect(screen.getByText('唤醒 / 隐藏主程序')).toBeInTheDocument();

    // 验证 4 个快捷键按键胶囊文本
    expect(screen.getByText('F4')).toBeInTheDocument();
    expect(screen.getByText('Alt+Space')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+C')).toBeInTheDocument();
    expect(screen.getByText('Alt+Q')).toBeInTheDocument();

    // 验证 4 个重新录制按钮与 4 个测试按钮
    const recordButtons = screen.getAllByRole('button', { name: /重新录制/i });
    expect(recordButtons).toHaveLength(4);

    const testButtons = screen.getAllByRole('button', { name: /🚀 测试/i });
    expect(testButtons).toHaveLength(4);

    // 点击剪贴板测试按钮
    fireEvent.click(testButtons[2]);
    expect(onTriggerClipboard).toHaveBeenCalledTimes(1);

    // 点击唤醒隐藏测试按钮
    fireEvent.click(testButtons[3]);
    expect(onToggleWindow).toHaveBeenCalledTimes(1);
  });

  it('点击剪贴板重新录制并录制新快捷键', () => {
    render(<HotkeyPanel />);

    const recordButtons = screen.getAllByRole('button', { name: /重新录制/i });
    const clipboardRecordBtn = recordButtons[2];

    fireEvent.click(clipboardRecordBtn);
    expect(screen.getByText('⌨️ 请按下按键...')).toBeInTheDocument();

    // 模拟按下 Ctrl + Shift + X
    fireEvent.keyDown(window, {
      key: 'X',
      code: 'KeyX',
      ctrlKey: true,
      shiftKey: true,
    });

    // store 与界面更新
    expect(useSettingsStore.getState().settings.clipboardHotkey).toBe('Ctrl+Shift+X');
    expect(screen.getByText('Ctrl+Shift+X')).toBeInTheDocument();
  });

  it('截图划词首选通道下拉按设置动态生成（仅展示已配置可用 AI 与已开启在线引擎）', () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        llmConfigs: [
          {
            id: 'llm-deepseek',
            provider: 'DeepSeek',
            apiKey: 'sk-deepseek-test',
            model: 'deepseek-chat',
            endpoint: 'https://api.deepseek.com/v1',
          },
          {
            id: 'llm-unconfigured',
            provider: 'OpenAI',
            apiKey: '',
            model: 'gpt-4o-mini',
            endpoint: 'https://api.openai.com/v1',
          },
        ],
        onlineEngines: {
          google: true,
          bing: false,
          youdao: true,
          deepl: false,
          myMemory: false,
          baidu: false,
          tencent: false,
        },
      },
    });

    render(<HotkeyPanel />);

    const select = screen.getAllByRole('combobox').find(
      (el) => (el as HTMLSelectElement).value === 'auto'
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();

    // 仅已配置 Key 的 DeepSeek 会展示，未配置的 OpenAI 不在下拉选项中
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent || '');
    expect(optionTexts).toContain('🤖 DeepSeek (deepseek-chat)');
    expect(optionTexts.some((t) => t.includes('OpenAI'))).toBe(false);

    // 仅已开启的在线引擎展示（开启了 google / youdao，关闭了 bing）
    expect(screen.getByText('🌐 Google 官方翻译 (免 Key 极速)')).toBeInTheDocument();
    expect(screen.getByText('📶 网易有道翻译')).toBeInTheDocument();
    expect(screen.queryByText('🔷 微软 Bing 神经网络翻译')).toBeNull();

    // 切换为指定通道后写入 store
    fireEvent.change(select, { target: { value: 'llm:llm-deepseek' } });
    expect(useSettingsStore.getState().settings.captureEngine).toBe('llm:llm-deepseek');
  });

  it('旧版本遗留的 captureEngine 值在下拉中以兜底选项展示', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, captureEngine: 'deepseek' },
    });
    render(<HotkeyPanel />);

    // 旧值不在动态选项中，必须以兜底选项呈现而不是下拉空白
    expect(screen.getByText('⚙️ deepseek（旧版通道，重新选择即更新）')).toBeInTheDocument();
  });

  it('默认状态下仅开启「全局划词选区」，其余三个快捷键默认关闭', () => {
    expect(DEFAULT_SETTINGS.captureHotkeyEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.spotlightHotkeyEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.clipboardHotkeyEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.toggleWindowHotkeyEnabled).toBe(false);

    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
    });
    render(<HotkeyPanel />);

    const toggles = screen.getAllByTitle('开启或关闭该快捷键');
    expect(toggles).toHaveLength(4);
    // 第 1 个是划词选区：激活高亮 bg-blue-600
    expect(toggles[0].className).toContain('bg-blue-600');
    // 其余 3 个默认关闭：未激活
    expect(toggles[1].className).not.toContain('bg-purple-600');
    expect(toggles[2].className).not.toContain('bg-emerald-600');
    expect(toggles[3].className).not.toContain('bg-amber-600');
  });
});
