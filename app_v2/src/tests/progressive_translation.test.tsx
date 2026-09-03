import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { PreferencePanel } from '../components/Settings/panels/PreferencePanel';
import { cmdLlmBatchRefine } from '../services/tauri';

vi.mock('../services/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/tauri')>();
  return {
    ...actual,
    cmdGetSettings: vi.fn().mockResolvedValue({}),
    cmdSaveSettings: vi.fn().mockResolvedValue(undefined),
    cmdGetOcrEngineStatus: vi.fn().mockResolvedValue({ status: 'ready', detail: 'RapidOCR ready' }),
    cmdOfflineStatus: vi.fn().mockResolvedValue({ installed: false, active_model_id: '' }),
    cmdGetAutoStart: vi.fn().mockResolvedValue(false),
    cmdLlmBatchRefine: vi.fn().mockImplementation(async (phrases: string[]) => {
      const res: Record<string, string> = {};
      phrases.forEach((p) => {
        res[p] = `${p} 的 AI 高质量精翻`;
      });
      return res;
    }),
  };
});

describe('快慢双流渐进翻译 (Speculative Progressive Translation) 测试套件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('设置状态机支持读取与切换 enableLlmProgressiveRefine 开关', () => {
    const store = useSettingsStore.getState();
    expect(store.settings.enableLlmProgressiveRefine).not.toBe(false);

    store.setEnableLlmProgressiveRefine(false);
    expect(useSettingsStore.getState().settings.enableLlmProgressiveRefine).toBe(false);

    store.setEnableLlmProgressiveRefine(true);
    expect(useSettingsStore.getState().settings.enableLlmProgressiveRefine).toBe(true);
  });

  it('在偏好设置面板中正确渲染「快慢双流渐进翻译」开关并响应点击', async () => {
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, enableLlmProgressiveRefine: true },
    }));

    render(<PreferencePanel />);

    const label = await screen.findByText(/快慢双流渐进翻译/);
    expect(label).toBeInTheDocument();
    expect(screen.getByText(/截图划词后在线引擎并发竞速秒出首版译文/)).toBeInTheDocument();

    const checkbox = label.closest('div.rounded-xl')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().settings.enableLlmProgressiveRefine).toBe(false);
  });

  it('cmdLlmBatchRefine 能够批量返回大模型润色结果', async () => {
    const mockLlm = {
      id: 'test-deepseek',
      provider: 'DeepSeek',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
    };

    const res = await cmdLlmBatchRefine(['Subsurface Scattering', 'Principled BSDF'], mockLlm, 'terminology');
    expect(res['Subsurface Scattering']).toBe('Subsurface Scattering 的 AI 高质量精翻');
    expect(res['Principled BSDF']).toBe('Principled BSDF 的 AI 高质量精翻');
  });
});
