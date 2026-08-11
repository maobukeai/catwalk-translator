# Orchestration Plan: CG AI Screenshot Translator (Tauri 2.0 + React 18 + RapidOCR ONNX)

## Objective
Refactor and upgrade existing CG AI Screenshot Translator to a modern desktop app based on Tauri 2.0 (Rust), React 18 (Vite + TailwindCSS), RapidOCR ONNX, CG/3D domain dictionaries, multi-tier translation pipeline, and high-DPI precise overlay.

## Workflow & Phases

### Phase 0: Survey & Specification Mining
- Spawn 3 Spec Miners / Explorers in parallel to inspect existing codebase (`main.py`, `core`, `app_v2`, `scratch`) and requirements (`ORIGINAL_REQUEST.md`).
- Output: Complete Feature Inventory, existing architecture analysis, dependencies, and requirements mapping.

### Phase 1: Architecture Design & Project Matrix (`PROJECT.md`)
- Establish global architecture, code layout, interface contracts between Rust backend and React frontend.
- Define Milestones (Tauri Infrastructure, RapidOCR ONNX & High-DPI engine, Multi-tier Translation Engine, High-aesthetic React 18 UI & Overlay, Final E2E Integration & Build Verification).
- Spawn E2E Testing Orchestrator for opaque-box test suite creation (`TEST_INFRA.md`).

### Phase 2: Milestone Execution (Parallel / Dependency-ordered Sub-orchestrators)
- Dispatch Sub-orchestrators for each Milestone.
- Each milestone runs iteration loop: Explorer -> Worker -> Reviewer -> Challenger -> Auditor.
- Verification gates for build, unit tests, E2E tests, clean forensic audit.

### Phase 3: Final Integration & Acceptance Verification
- Phase 1 of Final Milestone: Pass 100% E2E test suite (Tiers 1-4).
- Phase 2 of Final Milestone: Adversarial Coverage Hardening (Tier 5).
- Final Acceptance Verification against A1 and A2 acceptance criteria.
