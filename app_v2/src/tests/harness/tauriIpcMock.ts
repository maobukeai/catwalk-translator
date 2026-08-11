import { vi } from 'vitest';
import type {
  AppSettings,
  OcrResult,
  ColorSample,
  TranslationResult,
  LlmConfig,
  PresetDicts,
} from '../../services/types';

export type {
  AppSettings,
  OcrResult,
  ColorSample,
  TranslationResult,
  LlmConfig,
  PresetDicts,
};

export interface MockIPCState {
  settings: AppSettings;
  ocrResult: OcrResult;
  translationMap: Record<string, string>;
  colorSamples: ColorSample[];
  invokedCommands: Array<{ cmd: string; args: any }>;
}

let currentHarnessState: MockIPCState | null = null;

const globalInvokeFn = vi.fn(async (cmd: string, args?: any) => {
  if (!currentHarnessState) {
    throw new Error('IPC Harness state not initialized');
  }
  const state = currentHarnessState;
  state.invokedCommands.push({ cmd, args });
  switch (cmd) {
    case 'cmd_get_settings':
      return { ...state.settings };
    case 'cmd_save_settings':
      state.settings = { ...state.settings, ...args?.settings };
      return null;
    case 'cmd_capture_and_ocr':
      return state.ocrResult;
    case 'cmd_translate_phrases': {
      const phrases: string[] = args?.phrases || [];
      return phrases.map((p) => ({
        original: p,
        translated: state.translationMap[p] || `[Mock LLM] ${p}`,
        sourceTier: state.translationMap[p] ? 'preset_dict' : 'llm',
      }));
    }
    case 'cmd_sample_colors':
      return state.colorSamples;
    default:
      throw new Error(`Unhandled IPC command: ${cmd}`);
  }
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: any) => globalInvokeFn(cmd, args),
}));

export function getActiveHarness() {
  return currentHarnessState ? { state: currentHarnessState, invokeMock: globalInvokeFn } : null;
}

export function createMockIpcHarness(initialState?: Partial<MockIPCState>) {
  globalInvokeFn.mockClear();
  const state: MockIPCState = {
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
      ...initialState?.settings,
    },
    translationMap: {
      'Principled BSDF': '原理化 BSDF',
      'Subsurface Scattering': '次表面散射',
      'Roughness': '粗糙度',
      'AO Mixing Mode': 'AO 混合模式',
      'NavMesh Surface': '网格导航表面',
      ...initialState?.translationMap,
    },
    ocrResult: initialState?.ocrResult ?? {
      blocks: [
        {
          text: 'Principled BSDF',
          confidence: 0.99,
          boxRect: { x: 100, y: 50, width: 140, height: 24 },
        },
      ],
    },
    colorSamples: initialState?.colorSamples ?? [
      {
        boxRect: { x: 100, y: 50, width: 140, height: 24 },
        backgroundRgb: [42, 42, 42],
        textColor: '#FFFFFF',
      },
    ],
    invokedCommands: [],
  };

  currentHarnessState = state;
  return { state, invokeMock: globalInvokeFn };
}
