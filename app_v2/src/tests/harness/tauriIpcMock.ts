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
    case 'cmd_translate_phrases':
    case 'cmd_translate_phrases_styled': {
      const phrases: string[] = args?.phrases || [];
      return phrases.map((p) => ({
        original: p,
        translated: state.translationMap[p] || `[Mock LLM] ${p}`,
        sourceTier: state.translationMap[p] ? 'preset_dict' : 'llm',
      }));
    }
    case 'cmd_sample_colors':
      return state.colorSamples;
    case 'cmd_get_capture_sessions':
      return [];
    case 'cmd_get_clipboard_history':
      return [];
    case 'cmd_clear_clipboard_history':
      return null;
    // ── 无感查词浮窗 ──
    case 'cmd_get_lookup_payload':
      return null;
    case 'cmd_hide_lookup_popup':
      return null;
    case 'cmd_save_capture_session':
    case 'cmd_clear_capture_sessions':
      return null;
    // ── Overlay v2.4+ commands: safe defaults so un-wired tests stay quiet ──
    case 'cmd_region_image':
      return '';
    case 'cmd_watch_tick':
      return null;
    case 'cmd_hover_lookup':
      return null;
    case 'cmd_copy_region_image':
      return true;
    case 'cmd_save_region_image':
      return 'C:/mock/猫步翻译/截图翻译_0.png';
    case 'cmd_universal_translate':
      return {
        mainTranslation: args?.text ? `[Mock Universal] ${args.text}` : '',
        engines: [{ sourceTier: 'mock', translated: '' }],
      };
    case 'cmd_offline_models_status':
      return [];
    case 'cmd_get_active_ocr_version':
      return 'v4';
    case 'cmd_switch_ocr_version':
      return true;
    case 'cmd_download_offline_model':
    case 'cmd_delete_offline_model':
      return true;
    case 'cmd_ocr_engine_status':
      return { status: 'ready', detail: 'Windows 10/11 原生 WinRT 超高速 OCR 引擎已就绪' };
    // ── Offline phrase-dict engine (offline.rs) ──
    case 'cmd_offline_status':
      return mockOfflineStatus(false);
    case 'cmd_offline_install':
      return mockOfflineStatus(true);
    case 'cmd_offline_uninstall':
      return mockOfflineStatus(false);
    // ── Paste/drop image translation ──
    case 'cmd_image_ocr_translate':
      return {
        imageWidth: 800,
        imageHeight: 400,
        blocks: args?.imageBase64
          ? [
              {
                original: 'Roughness',
                translated: '粗糙度',
                sourceTier: 'preset_dict',
                confidence: 0.98,
                x: 40,
                y: 60,
                width: 220,
                height: 34,
                bgCss: 'rgb(42,42,42)',
                fgCss: '#ffffff',
              },
            ]
          : [],
      };
    // ── Backup & WebDAV sync (backup.rs / webdav.rs) ──
    case 'cmd_list_backups':
      return [];
    case 'cmd_create_backup':
      return {
        name: 'maobu_backup_20260822_120000.zip',
        sizeBytes: 2048,
        createdAtMs: Date.now(),
        source: 'manual',
      };
    case 'cmd_delete_backup':
    case 'cmd_restore_backup':
    case 'cmd_open_backup_dir':
      return null;
    case 'cmd_export_backup_base64':
      return '';
    case 'cmd_import_backup_base64':
      return {
        appVersion: '0.1.6',
        createdAt: '2026-08-22 12:00:00',
        historyCount: 0,
        captureSessionCount: 0,
      };
    case 'cmd_webdav_test':
      return '连接成功（12 ms）';
    case 'cmd_webdav_upload':
      return { name: 'maobu_backup_20260822_120000.zip', sizeBytes: 2048, deletedOld: 0 };
    case 'cmd_webdav_list':
      return [];
    case 'cmd_webdav_restore':
      return {
        appVersion: '0.1.6',
        createdAt: '2026-08-22 12:00:00',
        historyCount: 0,
        captureSessionCount: 0,
      };
    case 'cmd_webdav_delete':
      return null;
    // ── 通用词典 (GeneralDictCard / general_dict 命令) ──
    case 'cmd_general_dict_status':
      return { installed: false, entries: 0, installedAt: '' };
    case 'cmd_general_dict_lookup':
      return null;
    case 'cmd_general_dict_uninstall':
      return null;
    case 'cmd_general_dict_install':
      return { installed: true, entries: 0, installedAt: '' };
    default:
      throw new Error(`Unhandled IPC command: ${cmd}`);
  }
});

function mockOfflineStatus(installed: boolean) {
  return {
    installed,
    modelId: 'offline-phrase-dict-v1',
    modelName: '离线词条引擎 v1',
    version: installed ? '1.0.0' : '',
    dictEntries: installed ? 238 : 0,
    storageBytes: installed ? 18432 : 0,
    engineKind: 'phrase-dict',
    path: '(test mock)',
  };
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: any) => globalInvokeFn(cmd, args),
}));

// Components subscribe to Rust progress events (e.g. OcrModelsCard listens for
// 'model-download-progress'). The real @tauri-apps/api/event needs Tauri IPC
// internals that JSDOM cannot provide, so mock listen/emit with no-ops.
vi.mock('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
  once: async () => {},
  emit: async () => {},
  emitTo: async () => {},
  TauriEvent: {},
}));

export function getActiveHarness() {
  return currentHarnessState ? { state: currentHarnessState, invokeMock: globalInvokeFn } : null;
}

export function createMockIpcHarness(initialState?: Partial<MockIPCState>) {
  globalInvokeFn.mockClear();
  const state: MockIPCState = {
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
