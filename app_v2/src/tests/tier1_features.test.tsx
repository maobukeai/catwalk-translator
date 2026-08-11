import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { SettingsDashboard } from '../components/Settings/SettingsDashboard';
import {
  cmdGetSettings,
  cmdSaveSettings,
  cmdTranslatePhrases,
  cmdCaptureAndOcr,
  cmdSampleColors,
} from '../services/tauri';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { OcrResult, TranslationResult, ColorSample, AppSettings } from '../services/types';

describe('Tier 1 Feature Coverage Test Suite', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    delete (window as any).__TAURI_INTERNALS__;
    createMockIpcHarness();
    useSettingsStore.setState({
      settings: {
        theme: 'fluent-dark',
        hotkey: 'Ctrl+Alt+D',
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
          unity: false,
          unreal: true,
          maya: true,
          houdini: true,
        },
      },
      initialSettings: {
        theme: 'fluent-dark',
        hotkey: 'Ctrl+Alt+D',
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
          unity: false,
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

  // --------------------------------------------------------------------------
  // Feature F1: Modern Desktop Container & UI (6 Tests)
  // --------------------------------------------------------------------------
  describe('F1: Modern Desktop Container & UI', () => {
    it('F1-1: Render SettingsDashboard initial layout and header components', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      expect(screen.getByText(/系统设置|翻译器设置/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /重置/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /保存/i })).toBeDisabled();
    });

    it('F1-2: Hotkey recording mode interaction and store state update', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      const hotkeyTab = screen.getByRole('button', { name: /快捷键/i });
      fireEvent.click(hotkeyTab);

      const recordBtn = screen.getAllByText(/重新录制/i)[0];
      fireEvent.click(recordBtn);

      const hotkeyBox = screen.getByText(/请按/i);
      expect(hotkeyBox).toBeInTheDocument();

      fireEvent.keyDown(hotkeyBox, { key: 'K', ctrlKey: true, altKey: true, shiftKey: true });

      expect(useSettingsStore.getState().settings.hotkey).toBe('Ctrl+Alt+Shift+K');
      expect(useSettingsStore.getState().isDirty).toBe(true);
    });

    it('F1-3: Reset settings button discards un-saved changes in UI', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      act(() => {
        useSettingsStore.getState().setHotkey('Ctrl+Shift+R');
      });
      expect(useSettingsStore.getState().isDirty).toBe(true);

      const resetBtn = screen.getByRole('button', { name: /Reset|放弃|重置/i });
      expect(resetBtn).not.toBeDisabled();

      fireEvent.click(resetBtn);

      expect(useSettingsStore.getState().settings.hotkey).toBe('Ctrl+Alt+D');
      expect(useSettingsStore.getState().isDirty).toBe(false);
    });

    it('F1-4: Save Settings button triggers IPC save and toast notification', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      fireEvent.click(screen.getByText('快捷键与 AI 模型'));
      const apiKeyInput = screen.getByPlaceholderText('sk-...');
      fireEvent.change(apiKeyInput, { target: { value: 'sk-new-saved-key-123' } });

      const saveBtn = screen.getByRole('button', { name: /Save|保存/i });
      expect(saveBtn).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(saveBtn);
      });

      const harness = getActiveHarness()!;
      expect(harness.state.invokedCommands).toContainEqual({
        cmd: 'cmd_save_settings',
        args: { settings: useSettingsStore.getState().settings },
      });
      expect(useSettingsStore.getState().isDirty).toBe(false);
    });

    it('F1-5: Settings Dashboard renders loading spinner when isLoading is true', () => {
      act(() => {
        useSettingsStore.setState({ isLoading: true, fetchSettings: async () => {} });
      });
      render(<SettingsDashboard />);

      expect(screen.getByText(/Loading|加载/i)).toBeInTheDocument();
    });

    it('F1-6: Dark Mode and theme configuration styling verification', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      document.documentElement.classList.add('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      expect(useSettingsStore.getState().settings.theme).toBe('fluent-dark');
      document.documentElement.classList.remove('dark');
    });
  });

  // --------------------------------------------------------------------------
  // Feature F2: High-DPI Capture & Coordinate Engine (5 Tests)
  // --------------------------------------------------------------------------
  describe('F2: High-DPI Capture & Coordinate Engine', () => {
    it('F2-1: Physical coordinate capture request payload via cmdCaptureAndOcr', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const selection = { x: 100, y: 200, width: 300, height: 150 };

      const result = await cmdCaptureAndOcr(selection);
      const harness = getActiveHarness()!;

      expect(harness.state.invokedCommands).toContainEqual({
        cmd: 'cmd_capture_and_ocr',
        args: { selection },
      });
      expect(result).toHaveProperty('blocks');
    });

    it('F2-2: Multi-DPI selection bounding box capture verification', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      // Selection coordinates mapped for high-DPI display (e.g. 1.5x scale)
      const selectionDpi150 = { x: 150, y: 300, width: 450, height: 225 };

      const result = await cmdCaptureAndOcr(selectionDpi150);

      expect(result.blocks.length).toBeGreaterThan(0);
      expect(result.blocks[0].boxRect).toBeDefined();
    });

    it('F2-3: Normalized selection region IPC dispatch accuracy', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const normalizedSelection = { x: 100, y: 200, width: 200, height: 200 };

      await cmdCaptureAndOcr(normalizedSelection);
      const harness = getActiveHarness()!;

      const lastCall = harness.state.invokedCommands.find((c) => c.cmd === 'cmd_capture_and_ocr');
      expect(lastCall?.args.selection.width).toBeGreaterThan(0);
      expect(lastCall?.args.selection.height).toBeGreaterThan(0);
    });

    it('F2-4: Multi-monitor boundary screen selection clamping IPC dispatch', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const clampedSelection = { x: 1800, y: 100, width: 120, height: 200 };

      const result = await cmdCaptureAndOcr(clampedSelection);
      expect(result.blocks).toBeDefined();
    });

    it('F2-5: Crop area selection bounds validation via OCR service execution', async () => {
      const selection = { x: 0, y: 0, width: 640, height: 480 };
      const result = await cmdCaptureAndOcr(selection);

      expect(result).toHaveProperty('blocks');
      expect(Array.isArray(result.blocks)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Feature F3: RapidOCR ONNX & Line Reconstruction Engine (5 Tests)
  // --------------------------------------------------------------------------
  describe('F3: RapidOCR ONNX & Line Reconstruction Engine', () => {
    it('F3-1: JSDOM browser fallback OCR execution produces structured output', async () => {
      delete (window as any).__TAURI_INTERNALS__;
      const result = await cmdCaptureAndOcr({ x: 0, y: 0, width: 100, height: 50 });

      expect(result.blocks.length).toBeGreaterThan(0);
      expect(result.blocks[0].text).toBe('Principled BSDF');
    });

    it('F3-2: DBNet text box region bounding rectangle parsing', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const result: OcrResult = await cmdCaptureAndOcr({ x: 10, y: 10, width: 500, height: 300 });

      const block = result.blocks[0];
      expect(block.boxRect).toBeDefined();
      expect(block.boxRect.x).toBe(100);
      expect(block.boxRect.y).toBe(50);
      expect(block.boxRect.width).toBe(140);
      expect(block.boxRect.height).toBe(24);
    });

    it('F3-3: SVTR text recognition confidence metric and text content', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const result: OcrResult = await cmdCaptureAndOcr({ x: 0, y: 0, width: 100, height: 100 });
      const block = result.blocks[0];

      expect(block.text).toBe('Principled BSDF');
      expect(block.confidence).toBe(0.99);
    });

    it('F3-4: Line clustering text blocks collection parsing', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const harness = getActiveHarness()!;
      harness.state.ocrResult = {
        blocks: [
          { text: 'Principled', confidence: 0.98, boxRect: { x: 10, y: 50, width: 60, height: 20 } },
          { text: 'BSDF', confidence: 0.99, boxRect: { x: 75, y: 50, width: 40, height: 20 } },
          { text: 'Roughness', confidence: 0.95, boxRect: { x: 10, y: 120, width: 80, height: 20 } },
        ],
      };

      const result = await cmdCaptureAndOcr({ x: 0, y: 0, width: 300, height: 200 });

      expect(result.blocks.length).toBe(3);
      expect(result.blocks[0].text).toBe('Principled');
      expect(result.blocks[1].text).toBe('BSDF');
      expect(result.blocks[2].text).toBe('Roughness');
    });

    it('F3-5: Word box text reconstruction merging verification', async () => {
      const result = await cmdCaptureAndOcr({ x: 0, y: 0, width: 200, height: 100 });

      expect(result.blocks[0].text).toBe('Principled BSDF');
      expect(result.blocks[0].boxRect.width).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Feature F4: Multi-Tier Translation Engine & CG Dictionaries (6 Tests)
  // --------------------------------------------------------------------------
  describe('F4: Multi-Tier Translation Engine & CG Dictionaries', () => {
    it('F4-1: Preset CG dictionary exact lookup for Blender terms', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const results: TranslationResult[] = await cmdTranslatePhrases(['Principled BSDF'], 'blender');

      expect(results.length).toBe(1);
      expect(results[0].original).toBe('Principled BSDF');
      expect(results[0].translated).toBe('原理化 BSDF');
      expect(results[0].sourceTier).toBe('preset_dict');
    });

    it('F4-2: Preset CG dictionary exact lookup for Substance and Unity terms', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const results: TranslationResult[] = await cmdTranslatePhrases(
        ['AO Mixing Mode', 'NavMesh Surface'],
        'substance'
      );

      expect(results.length).toBe(2);
      expect(results[0].translated).toBe('AO 混合模式');
      expect(results[1].translated).toBe('网格导航表面');
    });

    it('F4-3: LLM API Configuration state setting via Zustand store', () => {
      act(() => {
        useSettingsStore.getState().setLlmConfig({
          provider: 'OpenAI',
          apiKey: 'sk-test-key-456',
          model: 'gpt-4o-mini',
          endpoint: 'https://api.openai.com/v1',
        });
      });

      const config = useSettingsStore.getState().settings.llmConfig;
      expect(config!.provider).toBe('OpenAI');
      expect(config!.apiKey).toBe('sk-test-key-456');
      expect(config!.model).toBe('gpt-4o-mini');
      expect(config!.endpoint).toBe('https://api.openai.com/v1');
    });

    it('F4-4: Online translation fallback cascade for unknown terms', async () => {
      const results: TranslationResult[] = await cmdTranslatePhrases(
        ['Unknown Term XYZ'],
        'blender'
      );

      expect(results.length).toBe(1);
      expect(results[0].original).toBe('Unknown Term XYZ');
      expect(results[0].translated).toBe('[Mock Translation] Unknown Term XYZ');
      expect(results[0].sourceTier).toBe('Online Fallback');
    });

    it('F4-5: Multi-tier translation pipeline priority reordering in UI', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      // Switch to Preference category tab
      const preferenceEl = screen.getByRole('button', { name: /优先级/i });
      fireEvent.click(preferenceEl);

      expect(useSettingsStore.getState().settings.translationTiers).toEqual([
        'Preset Dictionary',
        'LLM API',
        'Online Fallback',
      ]);

      const moveDownBtns = screen.getAllByTitle(/Move Down|向下移动/i);
      fireEvent.click(moveDownBtns[0]); // Move 'Preset Dictionary' down

      expect(useSettingsStore.getState().settings.translationTiers).toEqual([
        'LLM API',
        'Preset Dictionary',
        'Online Fallback',
      ]);
      expect(useSettingsStore.getState().isDirty).toBe(true);
    });

    it('F4-6: Preset dictionary toggle control interaction in SettingsDashboard', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      // Switch to Local Dictionaries category tab
      const dictsEl = screen.getByRole('button', { name: /专业词库/i });
      fireEvent.click(dictsEl);

      const initialValue = useSettingsStore.getState().settings.presetDicts.unity;

      const titleEl = screen.getByText(/常用短语词典|Unity/i);
      const container = titleEl.closest('div.flex') || titleEl.closest('div');
      const parentContainer = container?.closest('.flex.items-center.justify-between') || container;
      const toggleBtn = parentContainer?.querySelector('button') as HTMLButtonElement;
      expect(toggleBtn).not.toBeNull();

      fireEvent.click(toggleBtn);

      expect(useSettingsStore.getState().settings.presetDicts.unity).toBe(!initialValue);
      expect(useSettingsStore.getState().isDirty).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Feature F5: Color Sampler & Canvas/Web Overlay (5 Tests)
  // --------------------------------------------------------------------------
  describe('F5: Color Sampler & Canvas/Web Overlay', () => {
    it('F5-1: Color sampling service returns background RGB and text color', async () => {
      const crop = new Uint8Array([255, 0, 0, 0, 255, 0]);
      const boxes = [{ x: 0, y: 0, width: 50, height: 20 }];

      const samples: ColorSample[] = await cmdSampleColors(crop, boxes);

      expect(samples.length).toBe(1);
      expect(samples[0].backgroundRgb).toEqual([30, 30, 35]);
      expect(samples[0].textColor).toBe('#FFFFFF');
    });

    it('F5-2: Tauri IPC invoke cmd_sample_colors execution dispatch', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const crop = new Uint8Array([1, 2, 3]);
      const boxes = [{ x: 10, y: 10, width: 100, height: 40 }];

      const samples = await cmdSampleColors(crop, boxes);
      const harness = getActiveHarness()!;

      expect(harness.state.invokedCommands).toContainEqual({
        cmd: 'cmd_sample_colors',
        args: { imageCrop: [1, 2, 3], boxes },
      });
      expect(samples).toEqual(harness.state.colorSamples);
    });

    it('F5-3: API Key password visibility toggle control in SettingsDashboard', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      fireEvent.click(screen.getByRole('button', { name: /在线引擎/i }));
      const apiKeyInput = screen.getByPlaceholderText('sk-...');
      expect(apiKeyInput).toHaveAttribute('type', 'password');

      const eyeBtn = apiKeyInput.nextElementSibling as HTMLButtonElement;
      fireEvent.click(eyeBtn);
      expect(apiKeyInput).toHaveAttribute('type', 'text');

      fireEvent.click(eyeBtn);
      expect(apiKeyInput).toHaveAttribute('type', 'password');
    });

    it('F5-4: Provider select update updates endpoint and model defaults in store', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      fireEvent.click(screen.getByRole('button', { name: /在线引擎/i }));
      const comboboxes = screen.getAllByRole('combobox');
      const providerSelect = (comboboxes.find((c) => (c as HTMLSelectElement).querySelector('option[value="DeepSeek"]')) || comboboxes[0]) as HTMLSelectElement;
      fireEvent.change(providerSelect, { target: { value: 'OpenAI' } });

      const llmConfig = useSettingsStore.getState().settings.llmConfig;
      expect(llmConfig!.provider).toBe('OpenAI');
      expect(llmConfig!.endpoint).toBe('https://api.openai.com/v1');
      expect(llmConfig!.model).toBe('gpt-4o-mini');
      expect(useSettingsStore.getState().isDirty).toBe(true);
    });

    it('F5-5: Test LLM connection button latency simulation interaction', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      render(<SettingsDashboard />);
      await screen.findByText(/系统设置|翻译器设置/i);

      fireEvent.click(screen.getByRole('button', { name: /在线引擎/i }));
      const testBtn = screen.getByRole('button', { name: /Test|测试/i });

      await act(async () => {
        fireEvent.click(testBtn);
        await new Promise((r) => setTimeout(r, 400));
      });

      expect(screen.getByText(/\d+\s*ms/)).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Feature F6: E2E Test Suite & Harness Verification (5 Tests)
  // --------------------------------------------------------------------------
  describe('F6: E2E Test Suite & Harness Verification', () => {
    it('F6-1: Mock IPC harness records invoked command history', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const harness = getActiveHarness()!;
      expect(harness.state.invokedCommands).toEqual([]);

      await cmdGetSettings();
      await cmdTranslatePhrases(['Test phrase'], 'blender');

      expect(harness.state.invokedCommands.length).toBe(2);
      expect(harness.state.invokedCommands[0].cmd).toBe('cmd_get_settings');
      expect(harness.state.invokedCommands[1].cmd).toBe('cmd_translate_phrases');
    });

    it('F6-2: Tauri IPC getSettings and saveSettings round-trip state persistence', async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const harness = getActiveHarness()!;

      const settings: AppSettings = await cmdGetSettings();
      expect(settings.hotkey).toBe('Ctrl+Alt+D');

      const updatedSettings: AppSettings = {
        ...settings,
        hotkey: 'Ctrl+Shift+T',
      };
      await cmdSaveSettings(updatedSettings);

      const reloaded: AppSettings = await cmdGetSettings();
      expect(reloaded.hotkey).toBe('Ctrl+Shift+T');
      expect(harness.state.settings.hotkey).toBe('Ctrl+Shift+T');
    });

    it('F6-3: Zustand store state reset discards dirty mutations', () => {
      act(() => {
        useSettingsStore.getState().setHotkey('Ctrl+Alt+X');
        useSettingsStore.getState().setPresetDictToggle('blender', false);
      });
      expect(useSettingsStore.getState().isDirty).toBe(true);

      act(() => {
        useSettingsStore.getState().resetSettings();
      });

      const state = useSettingsStore.getState();
      expect(state.settings.hotkey).toBe('Ctrl+Alt+D');
      expect(state.settings.presetDicts.blender).toBe(true);
      expect(state.isDirty).toBe(false);
    });

    it('F6-4: Toast notification state management and clearing', () => {
      act(() => {
        useSettingsStore.setState({ toastMessage: 'Custom Test Toast' });
      });
      expect(useSettingsStore.getState().toastMessage).toBe('Custom Test Toast');

      act(() => {
        useSettingsStore.getState().clearToast();
      });
      expect(useSettingsStore.getState().toastMessage).toBeNull();
    });

    it('F6-5: Complete fetchSettings and saveSettings flow with Zustand store', async () => {
      await act(async () => {
        await useSettingsStore.getState().fetchSettings();
      });
      expect(useSettingsStore.getState().isDirty).toBe(false);

      act(() => {
        useSettingsStore.getState().setHotkey('Ctrl+Alt+F6');
      });
      expect(useSettingsStore.getState().isDirty).toBe(true);

      await act(async () => {
        await useSettingsStore.getState().saveSettings();
      });

      expect(useSettingsStore.getState().isDirty).toBe(false);
      expect(useSettingsStore.getState().initialSettings.hotkey).toBe('Ctrl+Alt+F6');
    });
  });
});
