# Scope: Milestone 4 — Color Sampler & Interactive Canvas/Web Overlay

## Architecture & Responsibilities
- **ColorSampler** (`app_v2/src-tauri/src/sampler.rs`):
  - `sample_outer_ring_median`: outer-ring pixel sampling with median RGB on **pure-RGB** byte streams.
  - `sample_from_full_bmp`: samples a bounding box from a full desktop BMP, respecting **54-byte BMP header + BGRA** pixel order.
  - `calc_perceived_brightness`: 0.299·R + 0.587·G + 0.114·B.
  - `decide_text_color`: brightness < 128 → `#FFFFFF`, ≥ 128 → `#000000`.
- **IPC** (`commands.rs`): `cmd_sample_colors_core_logic` (pure, testable) + `cmd_sample_colors` `#[tauri::command]` + `cmd_region_ocr_translate` (wires OCR → sampler → translator → OverlayBlock).
- **Overlay** (`app_v2/src/components/Overlay/CaptureOverlay.tsx`): selecting / processing / overlay 三态; real mouse selection on `.fixed.inset-0`; in-place DOM cards at `pos.x-3` / `pos.y-2`; drag reposition by mouse delta; empty-notice recovery; dark/light sampled bg → contrasting fg.

## Acceptance (Gate)
- Rust: full `cargo test` 0 failed; `m4_sampler_overlay_test.rs` covers median/brightness/text-color/BMP BGRA/`cmd_sample_colors_core_logic`.
- React: full `npm test -- --run` 0 failed; `m4_overlay_sampler.test.tsx` covers 三态 / empty-notice / in-place+drag / contrast text / sampler wrapper / fallback.
- No facade/dummy tests; no business-logic regression.
