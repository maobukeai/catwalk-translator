# Milestone 4 Gate Status

## Verdict: **PASSED** ✅

**Date**: 2026-08-11 (Gate verified at ~12:15+08:00)
**Target**: `app_v2/src-tauri/src/sampler.rs`, `commands.rs`(cmd_sample_colors), `app_v2/src/components/Overlay/CaptureOverlay.tsx`, tests
**Gate owner**: sub_orch_m4 (Rust side via Antigravity `agy -p` @ Gemini 3.6 Flash High; React side + final fixes hand-verified by parent brain)

## Gate Criteria

| Criterion | Status | Evidence |
|---|---|---|
| Build / tests pass (Rust) | ✅ PASS | `cargo test --manifest-path app_v2/src-tauri/Cargo.toml` → **90 passed, 0 failed** |
| Build / tests pass (React) | ✅ PASS | `npm --prefix app_v2 test -- --run` → **73 passed, 0 failed** |
| M4 sampler tests (Rust) | ✅ PASS | `m4_sampler_overlay_test.rs` → 11 passed (outer-ring median, perceived brightness, text-color threshold, BMP BGRA+header, cmd_sample_colors core) |
| M4 overlay tests (React) | ✅ PASS | `m4_overlay_sampler.test.tsx` → 7 passed (selecting/processing/overlay 三态, 空识别提示, 原位坐标+拖拽, 亮/暗底文字色, sampler wrapper, fallback) |
| Zero facade / dummy impl | ✅ PASS | Rust sampler tests synthesize real RGB/BMP pixels in Rust; React tests drive real mouse selection + act() state settle + parseFloat delta assertion |
| No business-logic regression | ✅ PASS | full suites re-run green (Rust 90, React 73) |

## What M4 Delivers (in-place overlay + color sampler)
- **ColorSampler** (`sampler.rs`): `sample_outer_ring_median` (pure-RGB semantics) + `sample_from_full_bmp` (BGRA + 54-byte BMP header, outer-ring median) + `calc_perceived_brightness` (BT.709-ish 0.299/0.587/0.114) + `decide_text_color` (<128 → #FFFFFF, ≥128 → #000000).
- **IPC**: `cmd_sample_colors_core_logic` (pure, testable) + `cmd_sample_colors` `#[tauri::command]`.
- **Overlay** (`CaptureOverlay.tsx`): selecting → processing → overlay 三态; in-place DOM cards at exact logical coordinates (`pos.x-3`/`pos.y-2`); drag reposition by mouse delta; empty-notice recovery; dark/light sampled background → contrasting text.

## Real bugs found & fixed
1. **Rust test construction bug** (not product code): the `prefers_bbox_ring_over_center` test initially drew its ring on a 256×256 canvas edge that the bbox did not actually cover → fixed to a 50×50 canvas whose ring the bbox fully spans, asserting the correct outer-ring RGB `[211,64,9]`. Verified via real `sample_from_full_bmp` on real BGRA bytes.
2. **React test issues** (all in the test file, not production code):
   - hoisted `vi.mock('@tauri-apps/api/core')` referenced a global not yet defined → fixed with `vi.doMock` per test + Tauri-fallback path for `cmdSampleColors`.
   - selection mouse events fired on `document.body` → fixed to target the real `.fixed.inset-0` container (where `onMouseDown/Move/Up` live).
   - drag delta assertion used `Number('97px')` → NaN → fixed to `parseFloat`.

## Result
M4 (Color Sampler & Interactive Canvas/Web Overlay) is **DONE**. M5 (E2E / adversarial / portable build) is now unblocked.
