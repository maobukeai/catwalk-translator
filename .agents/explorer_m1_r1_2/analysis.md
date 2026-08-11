# Frontend Architecture & Fluent Settings UI Design Analysis

**Target Workspace**: `app_v2/src/`  
**Milestone**: M1 (Tauri 2.0 Infra & React 18 Settings UI Skeleton)  
**Author**: explorer_m1_r1_2  
**Date**: 2026-08-09  

---

## 1. Executive Summary

This document presents a complete, production-ready frontend architecture and design specification for the **CG AI Screenshot Translator** (Milestone 1). The frontend is built on **React 18 + Vite 7 + TailwindCSS v4 + Zustand 5 + Lucide Icons** integrated with **Tauri 2.0 IPC**.

### Key Architectural Highlights:
1. **Fluent Design & Dark Mode System**: Acrylic glassmorphism, translucency (`backdrop-blur-xl`), smooth 200ms transitions, custom CSS variables for dark theme tokens, and accessible contrast ratios.
2. **Robust Tauri 2.0 IPC Abstraction**: Seamless `tauriIpc` service wrapper with automatic dev/browser fallback (`localStorage` + mock IPC) allowing pure web dev/testing without requiring a running Rust backend.
3. **Reactive State Management via Zustand**: Unified `useSettingsStore` handling asynchronous backend loading/saving, dirty form tracking, LLM connection testing with latency measuring, and toast notifications.
4. **Interactive Settings Sections**:
   - **Shortcut Key Recorder**: Real-time modifier key capturing (default `Ctrl+Alt+D`), validation, reset, and IPC hotkey testing.
   - **LLM Configurator**: Provider selectors (DeepSeek, OpenAI, Ollama, Custom), endpoint auto-fill, password masking, model presets, and connection diagnostic test with latency badge.
   - **Translation Tier Preference Selector**: Dynamic priority order management (Preset -> LLM -> Online Fallback) with execution flow visualization.
   - **Preset CG Dictionary Toggles**: Blender, Substance, Unity terminology dict toggles with real-time dict search test widget.

---

## 2. Existing Setup & Dependency Assessment

### Package Dependencies (`app_v2/package.json`)
The existing package configuration includes:
- **Core**: `react` (`^19.1.0` - fully compatible with React 18 hooks & functional components), `react-dom` (`^19.1.0`), `vite` (`^7.0.4`), `@vitejs/plugin-react` (`^4.6.0`).
- **State & UI Utilities**: `zustand` (`^5.0.14`), `lucide-react` (`^1.30.0`), `clsx` (`^2.1.1`), `tailwind-merge` (`^3.6.0`).
- **Styling**: `tailwindcss` (`^4.3.3`), `autoprefixer` (`^10.5.4`), `postcss` (`^8.5.26`).
- **Desktop Shell**: `@tauri-apps/api` (`^2`), `@tauri-apps/plugin-opener` (`^2`), `@tauri-apps/cli` (`^2`).

### TailwindCSS v4 & Theme Token Configuration (`app_v2/src/index.css`)
TailwindCSS v4 uses `@import "tailwindcss";` in `src/index.css`. We configure Fluent Design dark mode theme variables directly in `index.css`:

```css
@import "tailwindcss";

@layer base {
  :root {
    --bg-app: #0b0f19;
    --bg-surface: rgba(30, 41, 59, 0.6);
    --bg-surface-hover: rgba(51, 65, 85, 0.7);
    --border-subtle: rgba(148, 163, 184, 0.15);
    --border-focus: rgba(59, 130, 246, 0.5);
    --accent-blue: #3b82f6;
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
  }

  body {
    background-color: var(--bg-app);
    color: var(--text-primary);
    font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    user-select: none;
    overflow: hidden;
  }
}

/* Custom Acrylic Glass & Scrollbar Tokens */
.fluent-glass {
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.fluent-card {
  background: rgba(30, 41, 59, 0.45);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(148, 163, 184, 0.12);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.fluent-card:hover {
  background: rgba(30, 41, 59, 0.65);
  border-color: rgba(148, 163, 184, 0.25);
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.3);
}

.fluent-input {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #f8fafc;
  transition: all 0.15s ease;
}

.fluent-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}
```

---

## 3. Data Contracts & TypeScript Interfaces (`app_v2/src/types/settings.ts`)

To ensure 100% alignment with `PROJECT.md § Interface Contracts` and Rust `AppSettings` structs, we define strong TypeScript interfaces:

```typescript
// app_v2/src/types/settings.ts

export type LlmProvider = 'deepseek' | 'openai' | 'ollama' | 'custom';

export type TranslationTier = 'preset' | 'llm' | 'online';

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface PresetDictConfig {
  blender: boolean;
  substance: boolean;
  unity: boolean;
}

export interface AppSettings {
  shortcut: string;
  llmConfig: LlmConfig;
  tierPreference: TranslationTier[];
  presetDicts: PresetDictConfig;
  theme: 'dark' | 'light' | 'system';
  autoCopy: boolean;
  startWithSystem: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  shortcut: 'Ctrl+Alt+D',
  llmConfig: {
    provider: 'deepseek',
    apiKey: '',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.3,
    maxTokens: 1000,
  },
  tierPreference: ['preset', 'llm', 'online'],
  presetDicts: {
    blender: true,
    substance: true,
    unity: true,
  },
  theme: 'dark',
  autoCopy: true,
  startWithSystem: false,
};

export interface ProviderPreset {
  id: LlmProvider;
  name: string;
  defaultEndpoint: string;
  defaultModel: string;
  popularModels: string[];
  requiresApiKey: boolean;
}

export const PROVIDER_PRESETS: Record<LlmProvider, ProviderPreset> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek AI',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    popularModels: ['deepseek-chat', 'deepseek-reasoner'],
    requiresApiKey: true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    popularModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    requiresApiKey: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local LLM)',
    defaultEndpoint: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    popularModels: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:8b'],
    requiresApiKey: false,
  },
  custom: {
    id: 'custom',
    name: 'Custom Provider API',
    defaultEndpoint: 'http://localhost:8000/v1',
    defaultModel: 'custom-model',
    popularModels: [],
    requiresApiKey: true,
  },
};
```

---

## 4. Tauri IPC Service Layer (`app_v2/src/services/tauriIpc.ts`)

The service layer wraps `@tauri-apps/api/core` `invoke()` calls with snake_case <-> camelCase mapping and browser fallback support for non-Tauri environments:

```typescript
// app_v2/src/services/tauriIpc.ts

import { invoke } from '@tauri-apps/api/core';
import { AppSettings, DEFAULT_SETTINGS, LlmConfig } from '../types/settings';

const LOCAL_STORAGE_KEY = 'cg_translator_settings_v2';

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getAppSettings(): Promise<AppSettings> {
  if (!isTauriEnvironment()) {
    const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
    return cached ? JSON.parse(cached) : DEFAULT_SETTINGS;
  }

  try {
    const raw: any = await invoke('cmd_get_settings');
    // Map Rust snake_case to TS camelCase if necessary
    return {
      shortcut: raw.shortcut ?? DEFAULT_SETTINGS.shortcut,
      llmConfig: {
        provider: raw.llm_config?.provider ?? DEFAULT_SETTINGS.llmConfig.provider,
        apiKey: raw.llm_config?.api_key ?? DEFAULT_SETTINGS.llmConfig.apiKey,
        endpoint: raw.llm_config?.endpoint ?? DEFAULT_SETTINGS.llmConfig.endpoint,
        model: raw.llm_config?.model ?? DEFAULT_SETTINGS.llmConfig.model,
        temperature: raw.llm_config?.temperature ?? DEFAULT_SETTINGS.llmConfig.temperature,
        maxTokens: raw.llm_config?.max_tokens ?? DEFAULT_SETTINGS.llmConfig.maxTokens,
      },
      tierPreference: raw.tier_preference ?? DEFAULT_SETTINGS.tierPreference,
      presetDicts: {
        blender: raw.preset_dicts?.blender ?? DEFAULT_SETTINGS.presetDicts.blender,
        substance: raw.preset_dicts?.substance ?? DEFAULT_SETTINGS.presetDicts.substance,
        unity: raw.preset_dicts?.unity ?? DEFAULT_SETTINGS.presetDicts.unity,
      },
      theme: raw.theme ?? DEFAULT_SETTINGS.theme,
      autoCopy: raw.auto_copy ?? DEFAULT_SETTINGS.autoCopy,
      startWithSystem: raw.start_with_system ?? DEFAULT_SETTINGS.startWithSystem,
    };
  } catch (err) {
    console.warn('Tauri cmd_get_settings failed, falling back to defaults:', err);
    return DEFAULT_SETTINGS;
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  if (!isTauriEnvironment()) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
    return;
  }

  const payload = {
    settings: {
      shortcut: settings.shortcut,
      llm_config: {
        provider: settings.llmConfig.provider,
        api_key: settings.llmConfig.apiKey,
        endpoint: settings.llmConfig.endpoint,
        model: settings.llmConfig.model,
        temperature: settings.llmConfig.temperature,
        max_tokens: settings.llmConfig.maxTokens,
      },
      tier_preference: settings.tierPreference,
      preset_dicts: settings.presetDicts,
      theme: settings.theme,
      auto_copy: settings.autoCopy,
      start_with_system: settings.startWithSystem,
    },
  };

  await invoke('cmd_save_settings', payload);
}

export async function testLlmConnectionApi(llmConfig: LlmConfig): Promise<{ success: boolean; latencyMs: number; message: string }> {
  const startTime = performance.now();

  if (!isTauriEnvironment()) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (llmConfig.provider !== 'ollama' && !llmConfig.apiKey.trim()) {
      return { success: false, latencyMs: 350, message: 'API Key is required for ' + llmConfig.provider };
    }
    return { success: true, latencyMs: Math.round(performance.now() - startTime), message: 'Connection successful (Browser Mock)' };
  }

  try {
    // Invoke test translate phrase
    const res: any = await invoke('cmd_translate_phrases', {
      phrases: ['Principled BSDF'],
      preset: 'blender',
      llmConfig: {
        provider: llmConfig.provider,
        api_key: llmConfig.apiKey,
        endpoint: llmConfig.endpoint,
        model: llmConfig.model,
      },
    });

    const latencyMs = Math.round(performance.now() - startTime);
    return { success: true, latencyMs, message: `Connected (${latencyMs}ms)` };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - startTime);
    return { success: false, latencyMs, message: err?.toString() || 'Connection failed' };
  }
}
```

---

## 5. Zustand Store Architecture (`app_v2/src/store/useSettingsStore.ts`)

The store provides state management with reactive loading, dirty tracking, save feedback, and toast timers:

```typescript
// app_v2/src/store/useSettingsStore.ts

import { create } from 'zustand';
import { AppSettings, DEFAULT_SETTINGS, LlmConfig, TranslationTier, PresetDictConfig, LlmProvider, PROVIDER_PRESETS } from '../types/settings';
import { getAppSettings, saveAppSettings, testLlmConnectionApi } from '../services/tauriIpc';

export type SettingsTab = 'shortcut' | 'llm' | 'tier' | 'presets' | 'about';

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
}

interface SettingsStore {
  // State
  settings: AppSettings;
  initialSettings: AppSettings;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  activeTab: SettingsTab;
  
  // LLM Test Connection State
  testingConnection: boolean;
  testResult: { success: boolean; latencyMs: number; message: string } | null;

  // Toast Notification
  toast: ToastState | null;

  // Actions
  fetchSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  resetSettings: () => void;
  setActiveTab: (tab: SettingsTab) => void;
  
  // Mutators
  setShortcut: (shortcut: string) => void;
  setLlmProvider: (provider: LlmProvider) => void;
  updateLlmConfig: (patch: Partial<LlmConfig>) => void;
  setTierPreference: (tiers: TranslationTier[]) => void;
  togglePresetDict: (dict: keyof PresetDictConfig, enabled: boolean) => void;
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  
  // Operations
  testLlmConnection: () => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  clearToast: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  initialSettings: DEFAULT_SETTINGS,
  isDirty: false,
  isLoading: false,
  isSaving: false,
  activeTab: 'shortcut',
  testingConnection: false,
  testResult: null,
  toast: null,

  fetchSettings: async () => {
    set({ isLoading: true });
    try {
      const data = await getAppSettings();
      set({
        settings: data,
        initialSettings: JSON.parse(JSON.stringify(data)),
        isDirty: false,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      get().showToast('Failed to load settings from app', 'error');
    }
  },

  saveSettings: async () => {
    const { settings } = get();
    set({ isSaving: true });
    try {
      await saveAppSettings(settings);
      set({
        initialSettings: JSON.parse(JSON.stringify(settings)),
        isDirty: false,
        isSaving: false,
      });
      get().showToast('Settings saved successfully!', 'success');
    } catch (err: any) {
      set({ isSaving: false });
      get().showToast(`Save failed: ${err?.message || err}`, 'error');
    }
  },

  resetSettings: () => {
    const { initialSettings } = get();
    set({
      settings: JSON.parse(JSON.stringify(initialSettings)),
      isDirty: false,
      testResult: null,
    });
    get().showToast('Settings reset to last saved state', 'info');
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  setShortcut: (shortcut) => {
    set((state) => ({
      settings: { ...state.settings, shortcut },
      isDirty: true,
    }));
  },

  setLlmProvider: (provider) => {
    const preset = PROVIDER_PRESETS[provider];
    set((state) => ({
      settings: {
        ...state.settings,
        llmConfig: {
          ...state.settings.llmConfig,
          provider,
          endpoint: preset.defaultEndpoint,
          model: preset.defaultModel,
        },
      },
      isDirty: true,
      testResult: null,
    }));
  },

  updateLlmConfig: (patch) => {
    set((state) => ({
      settings: {
        ...state.settings,
        llmConfig: { ...state.settings.llmConfig, ...patch },
      },
      isDirty: true,
      testResult: null,
    }));
  },

  setTierPreference: (tiers) => {
    set((state) => ({
      settings: { ...state.settings, tierPreference: tiers },
      isDirty: true,
    }));
  },

  togglePresetDict: (dict, enabled) => {
    set((state) => ({
      settings: {
        ...state.settings,
        presetDicts: { ...state.settings.presetDicts, [dict]: enabled },
      },
      isDirty: true,
    }));
  },

  setTheme: (theme) => {
    set((state) => ({
      settings: { ...state.settings, theme },
      isDirty: true,
    }));
  },

  testLlmConnection: async () => {
    const { llmConfig } = get().settings;
    set({ testingConnection: true, testResult: null });
    const res = await testLlmConnectionApi(llmConfig);
    set({ testingConnection: false, testResult: res });
  },

  showToast: (message, type = 'info') => {
    set({ toast: { message, type } });
    setTimeout(() => {
      if (get().toast?.message === message) {
        set({ toast: null });
      }
    }, 3000);
  },

  clearToast: () => set({ toast: null }),
}));
```

---

## 6. Component Architecture & UI Hierarchy

```
app_v2/src/components/
├── Common/
│   ├── Button.tsx              # Fluent glass buttons (Primary, Secondary, Danger, Ghost)
│   ├── Card.tsx                # Translucent mica card wrapper with border highlight
│   ├── Input.tsx               # Styled input with clear icon & password toggle
│   ├── KeyRecorder.tsx         # Interactive hotkey listening input component
│   ├── Select.tsx              # Styled select dropdown
│   ├── Switch.tsx              # Fluent Design iOS-style smooth toggle switch
│   └── Toast.tsx               # Floating feedback message pill
└── Settings/
    ├── HeaderBar.tsx           # Window title bar with drag region, quick status badge & save button
    ├── LlmConfigSection.tsx    # LLM API configuration with provider cards, key input, test badge
    ├── PresetDictSection.tsx   # CG Dictionary toggles (Blender, Substance, Unity) & lookup tester
    ├── SettingsDashboard.tsx   # Main container bringing together Sidebar and Tab Content
    ├── ShortcutSection.tsx     # Shortcut recorder & modifier key badge inspector
    ├── Sidebar.tsx             # Left tab navigation bar (Shortcut, LLM API, Tier Pipeline, Presets)
    └── TierPipelineSection.tsx # Tier priority reorder list (Preset -> LLM -> Online) with flow chart
```

### Key UI Component Specifications

#### 1. `ShortcutSection.tsx` (Global Hotkey Recorder)
- **Visual Display**: Shows large key badges (e.g. `[ Ctrl ]` `+` `[ Alt ]` `+` `[ D ]`).
- **Interactive Recorder**:
  - Click "Record Shortcut" button -> state becomes `recording`.
  - Event listener on `window.addEventListener('keydown')`:
    - Prevents default browser shortcuts (`preventDefault()`).
    - Aggregates modifier keys: `Ctrl` (`e.ctrlKey`), `Alt` (`e.altKey`), `Shift` (`e.shiftKey`), `Win`/`Cmd` (`e.metaKey`).
    - Identifies primary key (e.g. `D`, `F1`, `Space`).
    - Format output string: e.g. `"Ctrl+Alt+D"`.
    - Automatically ends recording when valid combo is pressed or user hits `Escape`.
- **Validation**: Ensures at least one modifier key is included. Displays conflict warning badge if invalid.
- **Default Reset Button**: Instantly restores default `Ctrl+Alt+D`.

#### 2. `LlmConfigSection.tsx` (LLM API & Endpoint Config)
- **Provider Grid Selector**:
  - Visual selection cards for **DeepSeek**, **OpenAI**, **Ollama**, and **Custom Provider**.
  - Clicking a provider automatically populates default endpoint URL (`https://api.deepseek.com/v1`, `http://localhost:11434/v1`) and default model string.
- **API Key Field**: Masked password input with toggleable eye icon (`Eye` / `EyeOff`) to view API key safely.
- **Model Preset Selector**: Dropdown + custom model text override.
- **Diagnostic Connection Test**:
  - "Test Connection" button with spinner state (`testingConnection`).
  - Renders success badge with measured latency (e.g. `142ms`) or structured error banner (e.g. `401 Unauthorized - Invalid API Key`).

#### 3. `TierPipelineSection.tsx` (Translation Tier Preference Selector)
- **Priority List**:
  - Tier 1: **Preset Dictionaries** (Instant exact terminology lookup)
  - Tier 2: **LLM Engine** (Context-aware intelligent translation)
  - Tier 3: **Online Web Fallback** (Free API fallback)
- **Reordering Controls**: Up/Down buttons to reorder tiers.
- **Interactive Flow Diagram**: Visual arrow pipeline diagram showing step-by-step fallback flow:
  `[ 1. Preset Match? ] ── (No) ──> [ 2. LLM Query? ] ── (No) ──> [ 3. Online Web Fallback ]`

#### 4. `PresetDictSection.tsx` (Preset CG Dictionary Toggles)
- **Dictionary Cards**:
  - **Blender 3D Dictionary** (~5,000 terms: *Principled BSDF*, *Cycles*, *EEVEE*, *Subsurface Scattering*).
  - **Substance Painter/Designer** (~3,000 terms: *Albedo*, *Roughness*, *Metallic*, *Tri-planar*).
  - **Unity Game Engine** (~2,500 terms: *Prefab*, *RigidBody*, *Shader Graph*, *NavMesh*).
- **Master Switch**: "Enable All" / "Disable All" toggle button.
- **Live Terminology Tester**: Interactive search bar allowing immediate dictionary query testing (e.g. input `Principled BSDF` -> displays translation `原理化 BSDF`).

#### 5. `SettingsDashboard.tsx` & Layout Integration
- Top header with Tauri window drag region (`data-tauri-drag-region`), title, unsaved changes dirty indicator dot, "Reset" button, and primary "Save Changes" button.
- Clean sidebar navigation tabs with active line indicators and Lucide icons.
- Translucent backdrop blur (`fluent-glass`) styling.

---

## 7. Verification Method & Implementation Guide

### Verification Method for Implementer
1. **TypeScript Type Safety**:
   Run `npm run build` in `app_v2/` to ensure zero TS compilation errors (`tsc`).
2. **Web Dev Mode Testing**:
   Run `npm run dev` in `app_v2/`. Open browser at `http://localhost:1420`.
   - Verify setting changes persist in `localStorage`.
   - Test Shortcut key recorder with keypresses (`Ctrl+Alt+S`).
   - Test LLM provider switching (DeepSeek -> Ollama -> Custom).
   - Test LLM connection diagnostic mock.
   - Test Tier reordering and Dictionary toggles.
3. **Tauri Integration Check**:
   Run `npm run tauri dev` in `app_v2/` (or verify IPC contracts with `cmd_get_settings` and `cmd_save_settings`).

---

## 8. Summary Recommendation for Implementer

The implementer should construct the files in `app_v2/src/` in the following sequence:
1. `src/types/settings.ts` — Data models & provider presets.
2. `src/index.css` — Fluent Design CSS variables & acrylic utility classes.
3. `src/services/tauriIpc.ts` — Tauri IPC wrappers with browser mock fallback.
4. `src/store/useSettingsStore.ts` — Zustand store with async handlers.
5. `src/components/Common/` — Reusable primitives (`Button`, `Card`, `Input`, `Select`, `Switch`, `KeyRecorder`, `Toast`).
6. `src/components/Settings/` — Section components (`ShortcutSection`, `LlmConfigSection`, `TierPipelineSection`, `PresetDictSection`, `Sidebar`, `HeaderBar`, `SettingsDashboard`).
7. `src/App.tsx` — Integrate `SettingsDashboard`.
