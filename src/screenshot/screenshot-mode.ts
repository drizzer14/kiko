import { SCREENSHOT_LANG, SCREENSHOT_MODE } from '@env';

import { type AppLanguage, appLanguages } from '../i18n';

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
