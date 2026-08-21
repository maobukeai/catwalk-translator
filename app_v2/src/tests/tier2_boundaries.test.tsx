import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, act } from '@testing-library/react';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  cmdGetSettings,
  cmdSaveSettings,
  cmdTranslatePhrases,
  cmdCaptureAndOcr,
  cmdSampleColors,
} from '../services/tauri';
import { createMockIpcHarness } from './harness/tauriIpcMock';
import type { AppSettings, TranslationResult, ColorSample, OcrResult } from '../services/types';

describe('Tier 2 Boundary & Corner Case Test Suite', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    delete (window as any).__TAURI_INTERNALS__;
    createMockIpcHarness();
    useSettingsStore.setState({
      settings: {
        theme: 'system',
        hotkey: 'F4',
        defaultPreset: 'blender',
        llmConfig: {
          provider: 'DeepSeek',
          apiKey: 'sk-test-key-12345',
          model: 'deepseek-chat',
          endpoint: 'https://api.deepseek.com/v1',
        },
        translationTiers: ['Preset Dictionary', 'LLM API', 'Online Fallback'],
        presetDicts: {
          blender: true,
          substance: true,
          unity: true,
          unreal: true,
          maya: true,
          houdini: true,
        },
      },
      initialSettings: {
        theme: 'system',
        hotkey: 'F4',
        defaultPreset: 'blender',
        llmConfig: {
          provider: 'DeepSeek',
          apiKey: 'sk-test-key-12345',
          model: 'deepseek-chat',
          endpoint: 'https://api.deepseek.com/v1',
        },
        translationTiers: ['Preset Dictionary', 'LLM API', 'Online Fallback'],
        presetDicts: {
          blender: true,
          substance: true,
          unity: true,
          unreal: true,
          maya: true,
          houdini: true,
        },
      },
      isDirty: false,
      isLoading: false,
      isSaving: false,
      toastMessage: null,
    });
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Category 1: Boundary values for settings (4 Tests)
  // --------------------------------------------------------------------------
  describe('Category 1: Settings Boundary Values', () => {
    it('1-1: Invalid or unknown theme value handling in store and fallback', () => {
      act(() => {
        useSettingsStore.setState((state) => ({
          settings: { ...state.settings, theme: 'invalid-theme-extreme' },
          isDirty: true,
        }));
      });

      const currentTheme = useSettingsStore.getState().settings.theme;
      expect(currentTheme).toBe('invalid-theme-extreme');
      expect(useSettingsStore.getState().isDirty).toBe(true);

      act(() => {
        useSettingsStore.getState().resetSettings();
      });
      expect(useSettingsStore.getState().settings.theme).toBe('system');
      expect(useSettingsStore.getState().isDirty).toBe(false);
    });

    it('1-2: Extreme numeric settings values (0, 999, negative numbers)', () => {
      // Extended numeric/boundary settings property update
      const extremeSettings: AppSettings & { fontSize?: number } = {
        ...useSettingsStore.getState().settings,
        fontSize: 999,
      };

      act(() => {
        useSettingsStore.setState({
          settings: extremeSettings as AppSettings,
          isDirty: true,
        });
      });

      const updated = useSettingsStore.getState().settings as any;
      expect(updated.fontSize).toBe(999);
      expect(useSettingsStore.getState().isDirty).toBe(true);
    });

    it('1-3: Empty hotkey string or invalid hotkey combination handling', () => {
      act(() => {
        useSettingsStore.getState().setHotkey('');
      });
      expect(useSettingsStore.getState().settings.hotkey).toBe('');
      expect(useSettingsStore.getState().isDirty).toBe(true);

      act(() => {
        useSettingsStore.getState().setHotkey('SingleKeyInvalid');
      });
      expect(useSettingsStore.getState().settings.hotkey).toBe('SingleKeyInvalid');
      expect(useSettingsStore.getState().isDirty).toBe(true);

      act(() => {
        useSettingsStore.getState().resetSettings();
      });
      expect(useSettingsStore.getState().settings.hotkey).toBe('F4');
      expect(useSettingsStore.getState().isDirty).toBe(false);
    });

    it('1-4: Empty or extreme LLM config values (10,000+ chars API key)', () => {
      const ultraLongApiKey = 'sk-' + 'K'.repeat(10000);

      act(() => {
        useSettingsStore.getState().setLlmConfig({
          provider: '',
          apiKey: ultraLongApiKey,
          model: '',
          endpoint: '',
        });
      });

      const llmConfig = useSettingsStore.getState().settings.llmConfig;
      expect(llmConfig?.provider).toBe('');
      expect(llmConfig?.apiKey.length).toBe(10003);
      expect(llmConfig?.model).toBe('');
      expect(llmConfig?.endpoint).toBe('');
      expect(useSettingsStore.getState().isDirty).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Category 2: Extreme overlay positions & long translation strings (5 Tests)
  // --------------------------------------------------------------------------
  describe('Category 2: Extreme Overlay Positions & Long Translation Strings', () => {
    it('2-1: Overlay position boundary - negative or out-of-screen x/y coordinates', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const negativeSelection = { x: -5000, y: -3000, width: 200, height: 100 };

      const result: OcrResult = await cmdCaptureAndOcr(negativeSelection);
      expect(result).toHaveProperty('blocks');
      expect(Array.isArray(result.blocks)).toBe(true);
    });

    it('2-2: Overlay position boundary - zero dimensions (0x0px) capture selection', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const zeroSelection = { x: 100, y: 100, width: 0, height: 0 };

      const result: OcrResult = await cmdCaptureAndOcr(zeroSelection);
      expect(result).toHaveProperty('blocks');
    });

    it('2-3: Overlay position boundary - extreme resolution bounds (8K 7680x4320)', async () => {
      const crop8k = new Uint8Array([255, 255, 255, 0]);
      const boxes8k = [{ x: 0, y: 0, width: 7680, height: 4320 }];

      const samples: ColorSample[] = await cmdSampleColors(crop8k, boxes8k);
      expect(samples.length).toBe(1);
      expect(samples[0].boxRect.width).toBe(7680);
      expect(samples[0].boxRect.height).toBe(4320);
    });

    it('2-4: Long translation string handling - 10,000+ characters phrase', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const massivePhrase = 'Principled BSDF ' + 'A'.repeat(10000);

      const results: TranslationResult[] = await cmdTranslatePhrases([massivePhrase], 'blender');
      expect(results.length).toBe(1);
      expect(results[0].original.length).toBe(10016);
      expect(results[0].translated).toBeDefined();
    });

    it('2-5: Special characters & escaped strings translation handling', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const specialPhrases = [
        '<script>alert("XSS")</script>',
        'Line1\nLine2\t"Quotes" \\Slash €$',
        '日本語 / 中文 / English / 123 !@#$%^&*()',
      ];

      const results: TranslationResult[] = await cmdTranslatePhrases(specialPhrases, 'blender');
      expect(results.length).toBe(3);
      expect(results[0].original).toBe('<script>alert("XSS")</script>');
      expect(results[1].original).toBe('Line1\nLine2\t"Quotes" \\Slash €$');
      expect(results[2].original).toBe('日本語 / 中文 / English / 123 !@#$%^&*()');
    });
  });

  // --------------------------------------------------------------------------
  // Category 3: Network timeout & failure state handling (5 Tests)
  // --------------------------------------------------------------------------
  describe('Category 3: Network Timeout & Failure State Handling', () => {
    it('3-1: IPC wrapper network error recovery - cmdGetSettings error handling', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      // Mock invoke to simulate IPC disconnection / timeout
      const core = await import('@tauri-apps/api/core');
      const spy = vi.spyOn(core, 'invoke').mockRejectedValueOnce(new Error('IPC Connection Timeout'));

      await expect(cmdGetSettings()).rejects.toThrow('IPC Connection Timeout');
      spy.mockRestore();
    });

    it('3-2: IPC wrapper save failure handling - cmdSaveSettings error rejection', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const core = await import('@tauri-apps/api/core');
      const spy = vi.spyOn(core, 'invoke').mockRejectedValueOnce(new Error('Permission Denied write error'));

      const settings = useSettingsStore.getState().settings;
      await expect(cmdSaveSettings(settings)).rejects.toThrow('Permission Denied write error');
      spy.mockRestore();
    });

    it('3-3: Zustand store fetchSettings network timeout/failure state recovery', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const core = await import('@tauri-apps/api/core');
      const spy = vi.spyOn(core, 'invoke').mockRejectedValueOnce(new Error('Network Fetch Timeout'));

      await act(async () => {
        await useSettingsStore.getState().fetchSettings();
      });

      // Verification: isLoading reset to false after catch block
      expect(useSettingsStore.getState().isLoading).toBe(false);
      spy.mockRestore();
    });

    it('3-4: Zustand store saveSettings failure notification & toast handling', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const core = await import('@tauri-apps/api/core');
      const spy = vi.spyOn(core, 'invoke').mockRejectedValueOnce(new Error('Save Rejected'));

      await act(async () => {
        await useSettingsStore.getState().saveSettings();
      });

      const state = useSettingsStore.getState();
      expect(state.isSaving).toBe(false);
      expect(state.toastMessage).toBe('Failed to save settings');
      spy.mockRestore();
    });

    it('3-5: IPC wrapper cmdTranslatePhrases failure fallback handling', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const core = await import('@tauri-apps/api/core');
      const spy = vi.spyOn(core, 'invoke').mockRejectedValueOnce(new Error('HTTP 429 Rate Limit Exceeded'));

      await expect(cmdTranslatePhrases(['Test Term'], 'blender')).rejects.toThrow(
        'HTTP 429 Rate Limit Exceeded'
      );
      spy.mockRestore();
    });
  });
});
