# Design Specification: Appearance, Theme & Typography Settings

**Date**: 2026-08-09  
**Feature**: Appearance & Customization Settings (外观与个性化设置)  
**Status**: Draft for Review  

---

## 1. Overview & Problem Statement

Currently, the application window config specifies `"transparent": true` in [tauri.conf.json](file:///c:/Users/20269/Desktop/项目文件夹/翻译软件/app_v2/src-tauri/tauri.conf.json#L20), and [App.tsx](file:///c:/Users/20269/Desktop/项目文件夹/翻译软件/app_v2/src/App.tsx#L46) applies a semi-transparent background (`bg-[#121216]/85 backdrop-blur-2xl`). On systems where desktop acrylic blur is not active or hardware acceleration is limited, this semi-transparency makes the main software window see-through.

This feature adds a complete **Appearance & Customization (外观与个性化)** tab in Settings to allow users to:
1. Control window background transparency and opacity (including 100% solid background mode to fix transparent see-through).
2. Switch UI color themes (Dark, Light, System, Fluent Dark).
3. Adjust typography (Font Family & Font Size).
4. View real-time live preview of UI changes before saving.

---

## 2. User Experience & Architecture Design

### 2.1 Settings Tab Structure
The `SettingsDashboard` component will feature an **Appearance (外观设置)** section containing:
- **Live Preview Card**: Shows a real-time mini UI card reflecting chosen theme, font family, font size, and background opacity.
- **Theme Selection Cards**:
  - `Fluent Dark` (默认高级深色)
  - `Dark` (经典深色)
  - `Light` (明亮浅色)
  - `System` (跟随系统)
- **Window Transparency & Opacity Control**:
  - `Background Transparency Toggle`: Enable/disable window backdrop transparency.
  - `Opacity Slider`: Range 50% ~ 100% (at 100%, background is fully opaque solid color).
- **Typography Controls**:
  - `Font Family Selector`: System Default (`Segoe UI / YaHei`), Microsoft YaHei (`微软雅黑`), Segoe UI, Inter, Monospace (`JetBrains Mono`).
  - `Font Size Selector`: Small (13px), Medium (14px, default), Large (16px), Extra Large (18px).

---

## 3. Data Models & API Interface

### 3.1 TypeScript Types (`types.ts`)
```ts
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
  // ... existing settings fields
}
```

### 3.2 Rust Backend Data Model (`models.rs`)
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
```

---

## 4. Frontend Application Layer

1. **State Store (`useSettingsStore.ts`)**:
   - Store `appearance` inside `AppSettings`.
   - Provide setters: `setTheme`, `setEnableTransparency`, `setWindowOpacity`, `setFontFamily`, `setFontSize`.
2. **App Root (`App.tsx`)**:
   - Compute container background style dynamically:
     - If `enableTransparency` is false or `windowOpacity === 100`: Solid color background (`bg-[#121216]` in dark mode, `bg-slate-50` in light mode).
     - Otherwise: `rgba(18, 18, 22, ${opacity / 100})` with `backdrop-blur-2xl`.
   - Inject root font family and font size scale dynamically into container CSS variables / Tailwind classes.
3. **Settings Page (`SettingsDashboard.tsx`)**:
   - Render Appearance controls with intuitive segmented controls, sliders, and color preview badges.

---

## 5. Verification Plan

1. **Rust Backend Compilation & Tests**:
   - `cargo test` in `app_v2/src-tauri` to ensure settings serialization/deserialization pass cleanly.
2. **Frontend Build & Linter**:
   - `npm run build` in `app_v2` to verify zero TypeScript or Vite bundle errors.
3. **Functional Verification**:
   - Verify changing window opacity to 100% removes transparency completely.
   - Verify switching between Light Mode, Dark Mode, Font sizes, and Font families applies dynamically and persists after app restart.
