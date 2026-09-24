import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NetworkSettingsCard } from '../components/Settings/panels/NetworkSettingsCard';
import { useSettingsStore } from '../stores/useSettingsStore';
import { DEFAULT_SETTINGS } from '../services/defaultSettings';
import * as tauriService from '../services/tauri';

describe('NetworkSettingsCard & 3-State Proxy / Retry Strategy Store', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      initialSettings: { ...DEFAULT_SETTINGS },
      isDirty: false,
      isLoading: false,
      isSaving: false,
      toastMessage: null,
    });
  });

  it('renders Network section with Proxy Mode (跟随系统/不使用代理/手动代理) and Retry Preset dropdowns', () => {
    render(<NetworkSettingsCard />);

    expect(screen.getByTestId('network-settings-card')).toBeInTheDocument();
    expect(screen.getByText('网络')).toBeInTheDocument();
    expect(screen.getByText('代理设置')).toBeInTheDocument();
    expect(screen.getByText('代理模式')).toBeInTheDocument();
    expect(screen.getByText('重试策略')).toBeInTheDocument();
    expect(screen.getByText('重试预设')).toBeInTheDocument();

    const proxySelect = screen.getByTitle('代理模式') as HTMLSelectElement;
    expect(proxySelect.value).toBe('system');
    const proxyOptions = Array.from(proxySelect.options).map((o) => o.text);
    expect(proxyOptions).toEqual(['跟随系统', '不使用代理', '手动代理']);

    const retrySelect = screen.getByTitle('重试预设') as HTMLSelectElement;
    expect(retrySelect.value).toBe('balanced');
    const retryOptions = Array.from(retrySelect.options).map((o) => o.text);
    expect(retryOptions).toEqual(['标准均衡 (推荐)', '快速重试', '强力抗抖动', '不重试']);
  });

  it('switches between 跟随系统 (system), 不使用代理 (direct), and 手动代理 (manual)', () => {
    render(<NetworkSettingsCard />);

    const proxySelect = screen.getByTitle('代理模式') as HTMLSelectElement;

    // Default 'system': domestic bypass toggle is visible, manual proxy input is hidden
    expect(screen.getByTestId('proxy-bypass-domestic-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('proxy-url-input')).not.toBeInTheDocument();

    // Switch to 'direct' (不使用代理)
    fireEvent.change(proxySelect, { target: { value: 'direct' } });
    expect(useSettingsStore.getState().settings.proxyMode).toBe('direct');
    expect(useSettingsStore.getState().settings.proxyEnabled).toBe(false);
    expect(screen.queryByTestId('proxy-url-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('proxy-bypass-domestic-toggle')).not.toBeInTheDocument();

    // Switch to 'manual' (手动代理)
    fireEvent.change(proxySelect, { target: { value: 'manual' } });
    expect(useSettingsStore.getState().settings.proxyMode).toBe('manual');
    expect(useSettingsStore.getState().settings.proxyEnabled).toBe(true);
    expect(screen.getByTestId('proxy-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('proxy-bypass-domestic-toggle')).toBeInTheDocument();

    // Click quick preset button 'Clash (7890)'
    fireEvent.click(screen.getByRole('button', { name: 'Clash (7890)' }));
    expect(useSettingsStore.getState().settings.proxyUrl).toBe('http://127.0.0.1:7890');
    expect((screen.getByTestId('proxy-url-input') as HTMLInputElement).value).toBe('http://127.0.0.1:7890');
  });

  it('toggles domestic bypass and changes retry preset', () => {
    render(<NetworkSettingsCard />);

    const bypassToggle = screen.getByTestId('proxy-bypass-domestic-toggle') as HTMLInputElement;
    expect(bypassToggle.checked).toBe(true);

    fireEvent.click(bypassToggle);
    expect(useSettingsStore.getState().settings.proxyBypassDomestic).toBe(false);

    const retrySelect = screen.getByTitle('重试预设') as HTMLSelectElement;
    fireEvent.change(retrySelect, { target: { value: 'resilient' } });
    expect(useSettingsStore.getState().settings.retryPreset).toBe('resilient');
    expect(screen.getByText(/最多重试 3 次/)).toBeInTheDocument();

    fireEvent.change(retrySelect, { target: { value: 'none' } });
    expect(useSettingsStore.getState().settings.retryPreset).toBe('none');
    expect(screen.getByText(/不进行单通道重试/)).toBeInTheDocument();
  });

  it('migrates legacy proxyEnabled=true without proxyMode to manual mode in fetchSettings', async () => {
    const spy = vi.spyOn(tauriService, 'cmdGetSettings').mockResolvedValueOnce({
      ...DEFAULT_SETTINGS,
      proxyMode: undefined,
      proxyEnabled: true,
      proxyUrl: 'socks5://127.0.0.1:1080',
      proxyBypassDomestic: undefined,
      retryPreset: undefined,
    });

    await useSettingsStore.getState().fetchSettings();
    const state = useSettingsStore.getState().settings;
    expect(state.proxyMode).toBe('manual');
    expect(state.proxyEnabled).toBe(true);
    expect(state.proxyUrl).toBe('socks5://127.0.0.1:1080');
    expect(state.proxyBypassDomestic).toBe(true);
    expect(state.retryPreset).toBe('balanced');

    spy.mockRestore();
  });
});
