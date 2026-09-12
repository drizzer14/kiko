import {
  SCREENSHOT_LANG,
  SCREENSHOT_MODE,
  SCREENSHOT_SCENARIO,
  SCREENSHOT_STABLE_GLASS,
} from '@env';

import { type AppLanguage, appLanguages } from '../i18n';

/**
 * Which deterministic dataset the screenshot seed builds. `rich` (the default)
 * is the full marketing dataset; `empty` seeds no accounts so the app shows its
 * empty states; `locked` seeds the rich dataset but enables the app lock so the
 * cold-launch `LockGate` shows. See `screenshot-seed.ts`.
 */
export type ScreenshotScenario = 'rich' | 'empty' | 'locked';

const SCREENSHOT_SCENARIOS: readonly ScreenshotScenario[] = ['rich', 'empty', 'locked'];

/**
 * Whether a raw `@env` value opts into screenshot mode. Split out as a PURE
 * function because react-native-dotenv inlines the `@env` value at BUILD time
 * (its Babel plugin replaces the import reference with a literal and removes the
 * import — see babel.config.js), so a Jest test cannot mock `@env` to flip the
 * value at runtime. This boundary is what the test exercises both ways instead.
 */
export const parseScreenshotMode = (value: string | undefined): boolean => value === 'true';

/**
 * Resolve the seed language from a raw `@env` value, defaulting to `'en'` when
 * the key is unset or is not one of the supported `AppLanguage` codes. Pure for
 * the same testability reason as `parseScreenshotMode`.
 */
export const parseScreenshotLanguage = (value: string | undefined): AppLanguage => {
  return value !== undefined && (appLanguages as readonly string[]).includes(value)
    ? (value as AppLanguage)
    : 'en';
};

/**
 * Resolve the seed scenario from a raw `@env` value, defaulting to `'rich'` when
 * the key is unset or is not one of the supported scenarios. Pure for the same
 * testability reason as `parseScreenshotMode`.
 */
export const parseScreenshotScenario = (value: string | undefined): ScreenshotScenario =>
  value !== undefined && (SCREENSHOT_SCENARIOS as readonly string[]).includes(value)
    ? (value as ScreenshotScenario)
    : 'rich';

/**
 * DEV/TEST-ONLY flag: `true` only in a build made against `.env.screenshots`
 * (`ENVFILE=.env.screenshots`, which sets `SCREENSHOT_MODE=true`). The committed
 * `.env` carries no such key, so a production build inlines `undefined` here and
 * this is a dead branch — every screenshot-mode code path is gated on it.
 */
export const isScreenshotMode = (): boolean => parseScreenshotMode(SCREENSHOT_MODE);

/**
 * The language the deterministic screenshot seed applies via
 * `settingsRepo.setLanguage`. Read from `@env`'s `SCREENSHOT_LANG`, defaulting
 * to `'en'`; the committed `.env.screenshots` sets it to `'uk'`. Making the
 * language a single env value keeps a Ukrainian vs English screenshot set a
 * one-line env change plus a rebuild, with zero data drift.
 */
export const screenshotLanguage = (): AppLanguage => parseScreenshotLanguage(SCREENSHOT_LANG);

/**
 * The dataset scenario the deterministic screenshot seed builds. Read from
 * `@env`'s `SCREENSHOT_SCENARIO`, defaulting to `'rich'`; the marketing and the
 * default stable-glass env files leave it unset (so the rich set never drifts),
 * while `.env.screenshots.empty.stable` and `.env.screenshots.locked.stable`
 * pin the regression variants. A single env value keeps the empty-state and
 * lock-screen captures a one-line env change plus a rebuild.
 */
export const screenshotScenario = (): ScreenshotScenario =>
  parseScreenshotScenario(SCREENSHOT_SCENARIO);

/**
 * DEV/TEST-ONLY flag: `true` only in a build made against
 * `.env.screenshots.stable` (which sets BOTH `SCREENSHOT_MODE=true` and
 * `SCREENSHOT_STABLE_GLASS=true`). It is deliberately AND-gated on screenshot
 * mode so a stray `SCREENSHOT_STABLE_GLASS` alone can never touch a real build —
 * the committed `.env` and the marketing `.env.screenshots` both leave it unset,
 * so this is `false` in production and on the real-glass marketing path alike.
 *
 * When `true`, `GlassSurface` renders a fixed OPAQUE surface (no live
 * LiquidGlass sampling, no bloom) so the pixelmatch visual-regression check gets
 * byte-stable pixels; the 'clear' bloom glass otherwise re-refracts varying
 * chart/scroll content and drifts run-to-run. Reuses `parseScreenshotMode` for
 * the `=== 'true'` parse (the same exact-string semantics), so the parser is
 * already unit-tested both ways.
 */
export const isStableGlass = (): boolean =>
  isScreenshotMode() && parseScreenshotMode(SCREENSHOT_STABLE_GLASS);
