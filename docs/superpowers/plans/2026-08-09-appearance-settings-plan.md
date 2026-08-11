# Appearance Settings & Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Appearance (外观) settings section supporting dark/light/system themes, window background opacity control (including 100% solid mode to eliminate desktop see-through), font family & size controls, and live preview.

**Architecture:** Extend `AppSettings` in both TypeScript (`types.ts`) and Rust (`models.rs`), manage state in Zustand `useSettingsStore.ts`, bind dynamic styles & CSS variables in `App.tsx`, and construct a live preview UI in `SettingsDashboard.tsx`.

**Tech Stack:** React 18, Vite, TailwindCSS v4, Zustand, Lucide Icons, Rust (Tauri v2, serde).

## Global Constraints
- `app_v2/src-tauri/src/models.rs`: `#[serde(rename_all = "camelCase")]` for Rust JSON compatibility.
- `app_v2/src/stores/useSettingsStore.ts`: Must merge existing settings cleanly without breaking existing keys.
- Window opacity range: 50 to 100 integer percentage. When `windowOpacity === 100` or `enableTransparency === false`, render solid opaque background (`bg-[#121216]` in dark mode, `bg-slate-50` in light mode).

---

### Task 1: Update Data Models (TypeScript & Rust)

**Files:**
- Modify: `app_v2/src/services/types.ts`
- Modify: `app_v2/src-tauri/src/models.rs`

**Interfaces:**
- Consumes: Existing `AppSettings`
- Produces: `AppearanceSettings` interface in TS and `AppearanceSettings` struct in Rust.

- [ ] **Step 1: Update TypeScript types in `app_v2/src/services/types.ts`**

Add `AppearanceSettings`, `ThemeMode`, `FontFamilyOption`, and `FontSizeOption` types, and update `AppSettings`:

```typescript
export type ThemeMode = 'fluent-dark' | 'dark' | 'light' | 'system';
export type FontFamilyOption = 'system' | 'yahei' | 'segoe' | 'inter' | 'mono';
export type FontSizeOption = 'small' | 'medium' | 'large' | 'xlarge';

export interface AppearanceSettings {
  theme: ThemeMode;
  enableTransparency: boolean;
  windowOpacity: number; // 50 to 100
  fontFamily: FontFamilyOption;
  fontSize: FontSizeOption;
}

export interface AppSettings {
  theme: string;
  appearance?: AppearanceSettings;
  hotkey: string;
  defaultPreset: string;
  llmConfig: LlmConfig | null;
  translationTiers: string[];
  presetDicts: PresetDicts;
  onlineEngines?: OnlineEngines;
}
```

- [ ] **Step 2: Update Rust backend structs in `app_v2/src-tauri/src/models.rs`**

Add `AppearanceSettings` struct with serde attributes and `Default` impl:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: String,
    pub enable_transparency: bool,
    pub window_opacity: u8,
    pub font_family: String,
    pub font_size: String,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: "fluent-dark".to_string(),
            enable_transparency: true,
            window_opacity: 85,
            font_family: "system".to_string(),
            font_size: "medium".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub appearance: Option<AppearanceSettings>,
    pub hotkey: String,
    pub default_preset: String,
    pub llm_config: Option<LlmConfig>,
    pub translation_tiers: Vec<String>,
    pub preset_dicts: PresetDicts,
    pub online_engines: Option<OnlineEngines>,
}
```

- [ ] **Step 3: Test Rust compilation**

Run command in `app_v2/src-tauri`:
`cargo check`
Expected: Succeeds without errors.

---

### Task 2: Extend Zustand Store (`useSettingsStore.ts`)

**Files:**
- Modify: `app_v2/src/stores/useSettingsStore.ts`

**Interfaces:**
- Consumes: `AppearanceSettings` from `types.ts`
- Produces: State actions for updating theme, transparency, opacity, font family, and font size.

- [ ] **Step 1: Update `DEFAULT_SETTINGS` and actions in `useSettingsStore.ts`**

Include default `appearance` inside `DEFAULT_SETTINGS`:

```typescript
const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'fluent-dark',
  enableTransparency: true,
  windowOpacity: 85,
  fontFamily: 'system',
  fontSize: 'medium',
};
```

Add store actions:
- `setAppearance(updates: Partial<AppearanceSettings>)`
- `setThemeMode(theme: ThemeMode)`
- `setEnableTransparency(enabled: boolean)`
- `setWindowOpacity(opacity: number)`
- `setFontFamilyOption(font: FontFamilyOption)`
- `setFontSizeOption(size: FontSizeOption)`

- [ ] **Step 2: Verify TypeScript compilation**

Run in `app_v2`:
`npx tsc --noEmit`
Expected: Clean pass.

---

### Task 3: Apply Dynamic Appearance & Typography in `App.tsx` & `index.css`

**Files:**
- Modify: `app_v2/src/index.css`
- Modify: `app_v2/src/App.tsx`

**Interfaces:**
- Consumes: `appearance` state from `useSettingsStore`
- Produces: CSS variables and dynamic classes on container (`#root` / `<div className="...">`)

- [ ] **Step 1: Add Font Utility classes in `app_v2/src/index.css`**

Add CSS rules for font family and font size scales:

```css
.font-system { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
.font-yahei { font-family: 'Microsoft YaHei', '微软雅黑', sans-serif; }
.font-segoe { font-family: 'Segoe UI', sans-serif; }
.font-inter { font-family: 'Inter', sans-serif; }
.font-mono { font-family: 'JetBrains Mono', Consolas, Monaco, monospace; }

.font-scale-small { font-size: 13px; }
.font-scale-medium { font-size: 14px; }
.font-scale-large { font-size: 16px; }
.font-scale-xlarge { font-size: 18px; }
```

- [ ] **Step 2: Update `App.tsx` container styles dynamically**

In `App.tsx`:
```tsx
const appearance = settings.appearance || {
  theme: 'fluent-dark',
  enableTransparency: true,
  windowOpacity: 85,
  fontFamily: 'system',
  fontSize: 'medium',
};

const isLight = appearance.theme === 'light';
const isSolid = !appearance.enableTransparency || appearance.windowOpacity === 100;
const opacityVal = appearance.windowOpacity / 100;

// Dynamic Background Style
const bgStyle = isSolid
  ? { backgroundColor: isLight ? '#f8fafc' : '#121216' }
  : { backgroundColor: isLight ? `rgba(248, 250, 252, ${opacityVal})` : `rgba(18, 18, 22, ${opacityVal})` };
```

Apply `font-${appearance.fontFamily}`, `font-scale-${appearance.fontSize}`, and theme classes to `<div className="...">`.

- [ ] **Step 3: Run Vite build check**

Run in `app_v2`:
`npm run build`
Expected: Build passes without errors.

---

### Task 4: Add Appearance Section & Live Preview in `SettingsDashboard.tsx`

**Files:**
- Modify: `app_v2/src/components/Settings/SettingsDashboard.tsx`

**Interfaces:**
- Consumes: `useSettingsStore` appearance actions and current state.
- Produces: Appearance tab UI with Theme cards, Live Preview, Transparency slider, Font selectors.

- [ ] **Step 1: Add Appearance Tab Navigation & Component**

In `SettingsDashboard.tsx`:
Add `"appearance"` tab button alongside General, Translation Engine, Dictionary, LLM.

- [ ] **Step 2: Render Live Preview Box**

Create a visual card in the Appearance tab showing:
- Active theme indicator.
- Live sample translation text: `"🐱 猫步翻译 · Catwalk Translation UI"` rendered in chosen font and size.
- Background opacity indicator (e.g. `背景不透明度: 85%`).

- [ ] **Step 3: Render Control Widgets**

1. **Theme selector (4 tiles)**:
   - Fluent Dark (深色亚克力)
   - Dark (经典深色)
   - Light (明亮浅色)
   - System (跟随系统)
2. **Window Transparency & Opacity**:
   - Switch toggle: `"开启窗口背景透明"`
   - Slider: `50% ~ 100%` (Labels: `50%`, `75%`, `100% (完全不透明纯色)`)
3. **Typography**:
   - Font Family Dropdown / Segmented Tiles (系统默认, 微软雅黑, Segoe UI, Inter, 等宽)
   - Font Size Segmented Buttons (小 13px, 标准 14px, 大 16px, 超大 18px)

- [ ] **Step 4: Verify Frontend Build**

Run in `app_v2`:
`npm run build`
Expected: Success.

---

### Task 5: Final End-to-End Verification

- [ ] **Step 1: Rust backend check**

Run `cargo check` in `app_v2/src-tauri`

- [ ] **Step 2: Frontend build check**

Run `npm run build` in `app_v2`

- [ ] **Step 3: Verify Persistence**

Verify that changing `windowOpacity` to 100% sets solid background and persists across store saves.
