// Semgrep fixture (POSITIVE): the Guideline 5.6 "hidden feature" pattern —
// App Store rejected build 7 for "features intentionally hidden during
// review". `kiko-no-hidden-feature-flag-or-demo-import` MUST report a
// finding on each pinned line below: importing a SHOW_*/HIDE_*
// visibility-control @env flag, and a static `import` reaching from app
// source into the dev-only `e2e/` tree (where the screenshot/demo/seed
// dataset now lives). Never "fix" this file.
//
// The `declare module '@env'` block below is a fixture-local TYPE-CHECK-ONLY
// augmentation (ambient module declarations merge across the program) — it
// does not touch the real `src/env.d.ts` or add a real flag anywhere; it
// only lets this deliberately-bad import compile so `check:typecheck` (which
// scans `rules/fixtures/**` too) stays green on a file that must exist to
// prove the rule fires.
declare module '@env' {
  export const SHOW_UNREADY_FEATURE: string | undefined;
}

// EXPECT-FINDING
import { SHOW_UNREADY_FEATURE } from '@env';

// EXPECT-FINDING
import { seedScreenshotData } from '../../e2e/screenshot/seed/screenshot-seed';

export const isFeatureVisible = (): boolean => SHOW_UNREADY_FEATURE === 'true';

export const runSeed = async (): Promise<void> => {
  await seedScreenshotData();
};
