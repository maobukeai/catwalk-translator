## 2026-08-09T00:22:46Z
Setup Vitest testing framework and implement the React/TypeScript Tier 1 Feature Coverage test suite (`tier1_features.test.tsx`) for `app_v2`.

Mandatory Requirements:
1. Update `app_v2/package.json` to add `"test": "vitest run"` script and devDependencies (`vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`). Run `npm install` in `app_v2/` if needed.
2. Update `app_v2/vite.config.ts` to include `test: { globals: true, environment: "jsdom", setupFiles: ["./src/tests/harness/setup.ts"], include: ["src/tests/**/*.test.{ts,tsx}"] }`.
3. Update `app_v2/tsconfig.json` to include `"types": ["vitest/globals", "@testing-library/jest-dom"]`.
4. Create test harness files `app_v2/src/tests/harness/tauriIpcMock.ts` and `app_v2/src/tests/harness/setup.ts`.
5. Create `app_v2/src/tests/tier1_features.test.tsx` containing exactly 32 tests covering Features F1 through F6 (F1: 6, F2: 5, F3: 5, F4: 6, F5: 5, F6: 5) as outlined in `e2e_m1_explorer_2/handoff.md`.
6. Run `npm --prefix app_v2 test -- --run` to verify that all 32 tests execute and pass cleanly.
