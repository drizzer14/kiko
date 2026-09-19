// Ambient types for the `@env` virtual module (react-native-dotenv,
// babel.config.js) for the screenshot-only keys. RELOCATED here from
// `src/env.d.ts` (screenshot-purge Task 1, 2026-09-19): the Guideline 5.6
// purge requires `grep -rn 'SCREENSHOT' src/` to return nothing, but these
// keys are still read by `screenshot-mode.ts` below (its own @env reads are
// Task 2 scope — the screenshot-purge plan's slim-the-seed step, not this
// one) and by the `kiko-no-hidden-feature-flag-or-demo-import` Semgrep
// fixture's deliberately-kept `SCREENSHOT_MODE`-only negative case
// (`rules/fixtures/kiko-no-hidden-feature-flag-or-demo-import.good.ts`), so
// the declaration itself must keep existing SOMEWHERE the tsconfig `**/*.ts`
// glob includes — just never inside `src/`.
declare module '@env' {
  export const SCREENSHOT_MODE: string | undefined;
  export const SCREENSHOT_LANG: string | undefined;
  export const SCREENSHOT_SCENARIO: string | undefined;
  export const SCREENSHOT_STABLE_GLASS: string | undefined;
}
