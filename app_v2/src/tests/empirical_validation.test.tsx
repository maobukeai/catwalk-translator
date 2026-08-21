import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  cmdGetSettings,
  cmdSaveSettings,
  cmdTranslatePhrases,
  cmdCaptureAndOcr,
  cmdSampleColors,
  isTauri,
} from '../services/tauri';
import { SettingsDashboard } from '../components/Settings/SettingsDashboard';
import { getActiveHarness } from './harness/tauriIpcMock';

describe('Empirical Validation Test Suite for Milestone 1', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    delete (window as any).__TAURI_INTERNALS__;
    // Reset Zustand store state before each test
    useSettingsStore.setState({
      settings: {
        theme: 'system',
        hotkey: 'F4',
        defaultPreset: 'blender',
        llmConfig: {
          provider: 'DeepSeek',
          apiKey: '',
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
          apiKey: '',
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
  });

  // ==========================================================================
  // Section 1: Zustand Store State Persistence & Dirty Tracking
  // ==========================================================================
  describe('Zustand Store: Persistence & Dirty Tracking', () => {
    it('EV-1.1: fetchSettings initializes store state from IPC/browser service', async () => {
      localStorage.setItem(
        'cg_translator_settings_v2',
        JSON.stringify({
          theme: 'dark',
          hotkey: 'Ctrl+Shift+T',
          defaultPreset: 'substance',
          llmConfig: {
            provider: 'OpenAI',
            apiKey: 'sk-browser-test',
            model: 'gpt-4o-mini',
            endpoint: 'https://api.openai.com/v1',
          },
          translationTiers: ['LLM API', 'Preset Dictionary'],
          presetDicts: { blender: false, substance: true, unity: false },
        })
      );

      await act(async () => {
        await useSettingsStore.getState().fetchSettings();
      });

      const state = useSettingsStore.getState();
      expect(state.settings.hotkey).toBe('Ctrl+Shift+T');
      expect(state.settings.llmConfig!.provider).toBe('OpenAI');
      expect(state.settings.llmConfig!.apiKey).toBe('sk-browser-test');
      expect(state.settings.presetDicts.blender).toBe(false);
      expect(state.isDirty).toBe(false);
      expect(state.initialSettings).toEqual(state.settings);
    });

    it('EV-1.2: Dirty tracking flips isDirty to true on mutation and back to false on revert', () => {
      const store = useSettingsStore.getState();
      expect(store.isDirty).toBe(false);

      // Modify hotkey
      act(() => {
        useSettingsStore.getState().setHotkey('Ctrl+Alt+X');
      });
      expect(useSettingsStore.getState().isDirty).toBe(true);

      // Revert hotkey back to initial value
      act(() => {
        useSettingsStore.getState().setHotkey('F4');
      });
      expect(useSettingsStore.getState().isDirty).toBe(false);
    });

    it('EV-1.3: Deep object mutations in llmConfig & presetDicts trigger dirty tracking correctly', () => {
      expect(useSettingsStore.getState().isDirty).toBe(false);

      // Modify LLM API Key
      act(() => {
        useSettingsStore.getState().setLlmConfig({ apiKey: 'sk-secret-key-123' });
      });
      expect(useSettingsStore.getState().isDirty).toBe(true);

      // Revert LLM API Key
      act(() => {
        useSettingsStore.getState().setLlmConfig({ apiKey: '' });
      });
      expect(useSettingsStore.getState().isDirty).toBe(false);

      // Toggle preset dict
      act(() => {
        useSettingsStore.getState().setPresetDictToggle('unity', false);
      });
      expect(useSettingsStore.getState().isDirty).toBe(true);

      // Revert preset dict toggle
      act(() => {
        useSettingsStore.getState().setPresetDictToggle('unity', true);
      });
      expect(useSettingsStore.getState().isDirty).toBe(false);
    });

    it('EV-1.4: moveTier reorders translation tiers and respects array boundaries', () => {
      const store = useSettingsStore.getState();
      expect(store.settings.translationTiers).toEqual([
        'Preset Dictionary',
        'LLM API',
        'Online Fallback',
      ]);

      // Out of bounds left move -> no change
      act(() => {
        useSettingsStore.getState().moveTier(0, -1);
      });
      expect(useSettingsStore.getState().settings.translationTiers).toEqual([
        'Preset Dictionary',
        'LLM API',
        'Online Fallback',
      ]);
      expect(useSettingsStore.getState().isDirty).toBe(false);

      // Out of bounds right move -> no change
      act(() => {
        useSettingsStore.getState().moveTier(2, 5);
      });
      expect(useSettingsStore.getState().settings.translationTiers).toEqual([
        'Preset Dictionary',
        'LLM API',
        'Online Fallback',
      ]);
      expect(useSettingsStore.getState().isDirty).toBe(false);

      // Valid swap: move tier 0 to index 1
      act(() => {
        useSettingsStore.getState().moveTier(0, 1);
      });
      expect(useSettingsStore.getState().settings.translationTiers).toEqual([
        'LLM API',
        'Preset Dictionary',
        'Online Fallback',
      ]);
      expect(useSettingsStore.getState().isDirty).toBe(true);
    });

    it('EV-1.5: saveSettings updates initialSettings, clears isDirty, and sets toastMessage', async () => {
      act(() => {
        useSettingsStore.getState().setHotkey('Ctrl+Alt+S');
      });
      expect(useSettingsStore.getState().isDirty).toBe(true);

      await act(async () => {
        await useSettingsStore.getState().saveSettings();
      });

      const state = useSettingsStore.getState();
      expect(state.isDirty).toBe(false);
      expect(state.initialSettings.hotkey).toBe('Ctrl+Alt+S');
      expect(state.toastMessage).toBe('Settings saved successfully!');

      // Clear toast
      act(() => {
        useSettingsStore.getState().clearToast();
      });
      expect(useSettingsStore.getState().toastMessage).toBeNull();
    });

    it('EV-1.6: resetSettings discards un-saved changes and restores initialSettings', () => {
      act(() => {
        useSettingsStore.getState().setHotkey('Ctrl+Alt+Z');
        useSettingsStore.getState().setLlmConfig({ provider: 'Ollama' });
      });
      expect(useSettingsStore.getState().isDirty).toBe(true);

      act(() => {
        useSettingsStore.getState().resetSettings();
      });

      const state = useSettingsStore.getState();
      expect(state.settings.hotkey).toBe('F4');
      expect(state.settings.llmConfig!.provider).toBe('DeepSeek');
      expect(state.isDirty).toBe(false);
    });
  });

  // ==========================================================================
  // Section 2: Browser Mock Fallback & Storage Service
  // ==========================================================================
  describe('Browser Mock Fallback & Storage Service', () => {
    it('EV-2.1: isTauri returns false in browser/JSDOM environment and true when __TAURI_INTERNALS__ is present', () => {
      expect(isTauri()).toBe(false);

      (window as any).__TAURI_INTERNALS__ = {};
      expect(isTauri()).toBe(true);
    });

    it('EV-2.2: cmdGetSettings & cmdSaveSettings browser fallback localStorage round-trip', async () => {
      const testSettings = {
        theme: 'system',
        hotkey: 'Alt+Shift+D',
        defaultPreset: 'blender',
        llmConfig: {
          provider: 'DeepSeek',
          apiKey: 'sk-test-key-999',
          model: 'deepseek-chat',
          endpoint: 'https://api.deepseek.com/v1',
        },
        translationTiers: ['Preset Dictionary', 'LLM API'],
        presetDicts: { blender: true, substance: false, unity: true, unreal: true, maya: true, houdini: true },
      };

      await cmdSaveSettings(testSettings);
      const storedRaw = localStorage.getItem('cg_translator_settings_v2');
      expect(storedRaw).not.toBeNull();
      expect(JSON.parse(storedRaw!)).toEqual(testSettings);

      const loaded = await cmdGetSettings();
      expect(loaded).toEqual(testSettings);
    });

    it('EV-2.3: Graceful fallback when localStorage contains corrupted JSON data', async () => {
      localStorage.setItem('cg_translator_settings_v2', '{ INVALID JSON SYNTAX ERROR !!! }');

      const settings = await cmdGetSettings();
      expect(settings).toBeDefined();
      expect(settings.hotkey).toBe('F4');
      expect(settings.theme).toBe('system');
    });

    it('EV-2.4: cmdTranslatePhrases browser fallback translation dictionary matching & fallback formatting', async () => {
      const phrases = ['Principled BSDF', 'Roughness', 'Unknown Term XYZ'];
      const results = await cmdTranslatePhrases(phrases, 'blender');

      expect(results.length).toBe(3);
      expect(results[0]).toEqual({
        original: 'Principled BSDF',
        translated: '原理化 BSDF',
        sourceTier: 'blender',
      });
      expect(results[1]).toEqual({
        original: 'Roughness',
        translated: '粗糙度',
        sourceTier: 'blender',
      });
      expect(results[2]).toEqual({
        original: 'Unknown Term XYZ',
        translated: '[Mock Translation] Unknown Term XYZ',
        sourceTier: 'Online Fallback',
      });
    });

    it('EV-2.5: cmdCaptureAndOcr & cmdSampleColors browser fallback mocks', async () => {
      const ocrResult = await cmdCaptureAndOcr({ x: 10, y: 20, width: 200, height: 100 });
      expect(ocrResult.blocks.length).toBe(2);
      expect(ocrResult.blocks[0].text).toBe('Principled BSDF');

      const colorSamples = await cmdSampleColors(new Uint8Array([1, 2, 3]), [
        { x: 0, y: 0, width: 50, height: 20 },
      ]);
      expect(colorSamples.length).toBe(1);
      expect(colorSamples[0].backgroundRgb).toEqual([30, 30, 35]);
      expect(colorSamples[0].textColor).toBe('#FFFFFF');
    });

    it('EV-2.6: Tauri IPC routing when window.__TAURI_INTERNALS__ is present', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const harness = getActiveHarness()!;

      await cmdGetSettings();
      expect(harness.state.invokedCommands).toContainEqual({
        cmd: 'cmd_get_settings',
        args: undefined,
      });

      await cmdSaveSettings({
        theme: 'dark',
        hotkey: 'Ctrl+F1',
        defaultPreset: 'blender',
        llmConfig: { provider: 'DeepSeek', apiKey: '', model: 'm', endpoint: 'e' },
        translationTiers: [],
        presetDicts: { blender: true, substance: true, unity: true, unreal: true, maya: true, houdini: true },
      });
      expect(harness.state.invokedCommands).toContainEqual({
        cmd: 'cmd_save_settings',
        args: {
          settings: {
            theme: 'dark',
            hotkey: 'Ctrl+F1',
            defaultPreset: 'blender',
            llmConfig: { provider: 'DeepSeek', apiKey: '', model: 'm', endpoint: 'e' },
            translationTiers: [],
            presetDicts: { blender: true, substance: true, unity: true, unreal: true, maya: true, houdini: true },
          },
        },
      });
    });
  });

  // ==========================================================================
  // Section 3: Edge Cases (Empty Strings, Special Symbols, Unicode, Characters)
  // ==========================================================================
  describe('Edge Case Validation', () => {
    it('EV-3.1: Handling empty strings in hotkey, API key, endpoint, and model fields', () => {
      act(() => {
        useSettingsStore.getState().setHotkey('');
        useSettingsStore.getState().setLlmConfig({
          apiKey: '',
          endpoint: '',
          model: '',
        });
      });

      const state = useSettingsStore.getState();
      expect(state.settings.hotkey).toBe('');
      expect(state.settings.llmConfig!.apiKey).toBe('');
      expect(state.settings.llmConfig!.endpoint).toBe('');
      expect(state.settings.llmConfig!.model).toBe('');
      expect(state.isDirty).toBe(true);
    });

    it('EV-3.2: Special characters, symbols, and Unicode in LLM API Key & Endpoint URL', () => {
      const specialApiKey = 'sk-proj-$!@#$%^&*()_+={}:"<>?~|\\-key-🔑-中文-test';
      const specialEndpoint = 'https://custom-proxy.internal:8443/v1/chat?token=abc%20def&lang=zh_CN#section';

      act(() => {
        useSettingsStore.getState().setLlmConfig({
          apiKey: specialApiKey,
          endpoint: specialEndpoint,
        });
      });

      const state = useSettingsStore.getState();
      expect(state.settings.llmConfig!.apiKey).toBe(specialApiKey);
      expect(state.settings.llmConfig!.endpoint).toBe(specialEndpoint);
    });

    it('EV-3.3: Special characters, HTML tags, multiline, and empty string in cmdTranslatePhrases', async () => {
      const testPhrases = [
        '<script>alert("xss")</script>',
        'Line1\nLine2\r\nLine3',
        '   ',
        '',
        'Term with "double quotes" & \'single quotes\'',
      ];

      const results = await cmdTranslatePhrases(testPhrases, 'blender');
      expect(results.length).toBe(5);
      expect(results[0].original).toBe('<script>alert("xss")</script>');
      expect(results[1].original).toBe('Line1\nLine2\r\nLine3');
      expect(results[2].original).toBe('   ');
      expect(results[3].original).toBe('');
      expect(results[4].original).toBe('Term with "double quotes" & \'single quotes\'');
    });
  });

  // ==========================================================================
  // Section 4: UI Dashboard Component Validation & Provider Switching Stress Test
  // ==========================================================================
  describe('UI Component: SettingsDashboard & Provider Switching', () => {
    it('EV-4.1: Renders SettingsDashboard with initial values and action controls', async () => {
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      fireEvent.click(screen.getByText('快捷键与 AI 模型'));
      expect(screen.getByText(/系统设置|翻译器设置/i)).toBeInTheDocument();
      expect(screen.getByText('F4')).toBeInTheDocument();
      expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
      expect(screen.getByDisplayValue('https://api.deepseek.com/v1')).toBeInTheDocument();
    });

    it('EV-4.2: Toggling API key visibility between masked password and plain text', async () => {
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      fireEvent.click(screen.getByText('快捷键与 AI 模型'));
      const apiKeyInput = screen.getByPlaceholderText('sk-...');
      expect(apiKeyInput).toHaveAttribute('type', 'password');

      // Click eye icon button to reveal API key
      const toggleBtn = apiKeyInput.nextElementSibling as HTMLButtonElement;
      fireEvent.click(toggleBtn);
      expect(apiKeyInput).toHaveAttribute('type', 'text');

      fireEvent.click(toggleBtn);
      expect(apiKeyInput).toHaveAttribute('type', 'password');
    });

    it('EV-4.3: LLM Provider Selection updates endpoint and model to defaults', async () => {
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      fireEvent.click(screen.getByText('快捷键与 AI 模型'));
      const comboboxes = screen.getAllByRole('combobox');
      const providerSelect = (comboboxes.find((c) => (c as HTMLSelectElement).querySelector('option[value="DeepSeek"]')) || comboboxes[0]) as HTMLSelectElement;

      // Select Ollama
      fireEvent.change(providerSelect, { target: { value: 'Ollama' } });

      const currentEndpoint = useSettingsStore.getState().settings.llmConfig!.endpoint;
      const currentModel = useSettingsStore.getState().settings.llmConfig!.model;

      expect(providerSelect.value).toBe('Ollama');
      expect(currentEndpoint).toBe('http://localhost:11434/v1');
      expect(currentModel).toBe('llama3');
    });

    it('EV-4.4: Hotkey recording mode captures keyboard combination', async () => {
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      fireEvent.click(screen.getByText('快捷键与 AI 模型'));
      const recordBtn = screen.getAllByText(/重新录制/i)[0];
      fireEvent.click(recordBtn);

      expect(screen.getByText(/请按/i)).toBeInTheDocument();

      const hotkeyBox = screen.getByText(/请按/i);
      fireEvent.keyDown(hotkeyBox, { key: 'K', ctrlKey: true, altKey: true, shiftKey: true });

      expect(useSettingsStore.getState().settings.hotkey).toBe('Ctrl+Alt+Shift+K');
    });

    it('EV-4.5: Save button click invokes saveSettings and shows toast notification', async () => {
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      fireEvent.click(screen.getByRole('button', { name: /在线引擎/i }));
      // Make a change to enable Save button
      const apiKeyInput = screen.getByPlaceholderText('sk-...');
      fireEvent.change(apiKeyInput, { target: { value: 'sk-new-api-key-test' } });

      const saveBtn = screen.getByRole('button', { name: /Save|保存/i });
      expect(saveBtn).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(saveBtn);
      });

      expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument();
      expect(useSettingsStore.getState().isDirty).toBe(false);
    });
  });
});
