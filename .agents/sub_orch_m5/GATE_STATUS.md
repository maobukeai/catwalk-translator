# Milestone 5 Gate Status — S1 Portable Build

## Verdict: **S1 PASSED** ✅

**Date**: 2026-08-11 (~13:46+08:00)
**Target**: `app_v2/src-tauri/target/release/app_v2.exe` (portable release build)
**Scope**: portable build <40MB, cold-start <500ms, OCR models bundled.

## Requirements vs. Result (parent-verified)
| Requirement | Target | Measured | Verdict |
|---|---|---|---|
| Portable footprint | <40 MB | **39.8 MB** (exe 26.7 + ONNX 13.1 + dicts ~0) | PASSED (margin ~0.2MB, tight) |
| Cold start | <500 ms | **151.5 ms** median (157.3/146.3/151.5) | PASSED |
| OCR models bundled | offline usable | 3 .onnx + dict copied to exe-dir `models/` | PASSED |
| Rust regression | 0 failed | 101 passed / 0 failed | PASSED |
| React regression | 0 failed | 73 passed / 0 failed | PASSED |
| Frontend build | clean | `npm run build` ✓, `tsc` clean | PASSED |

## Code changes (by Antigravity executor, parent-reviewed)
- `app_v2/src-tauri/tauri.conf.json`: added `bundle.resources` (Map format: 3 ONNX models + 1 dict). NOTE: Tauri-build 2.6.3 `add_resource()` chain does NOT exist on `Attributes`; resources must be declared in `bundle.resources` (either string-array `List` or `Map`). The executor self-corrected from a broken `add_resource`/`try_build(true)` attempt.
- `app_v2/src-tauri/Cargo.toml`: added `[profile.release]` (opt-level=3, lto=fat, codegen-units=1, panic=abort, strip=symbols).
- `build.rs`: left clean with plain `tauri_build::build()` (interim `add_resource` additions rolled back).

## Caveat
- The <40MB pass is valid but has only ~0.2MB slack. The `ort` (Rapid ONNX Runtime, ~326MB .lib) and `windows` (~96MB) crates dominate the binary. If any dependency bumps, the target may be breached. A later pass should consider dynamic-linking the ONNX runtime or trimming `windows` feature set to reclaim margin.
