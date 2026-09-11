import {
  isScreenshotMode,
  parseScreenshotLanguage,
  parseScreenshotMode,
  screenshotLanguage,
} from './screenshot-mode';

// react-native-dotenv INLINES every `@env` value at BUILD time — its Babel
// plugin replaces each import reference with the literal read from `.env`
// (ENVFILE unset under Jest), then deletes the import (verified in
// node_modules/react-native-dotenv/index.js). So a Jest `jest.mock('@env')`
// never runs: there is no runtime module left to intercept. The build-time
// branch is therefore tested through the PURE parsers below, exercised with
// both a `'true'` and a non-`'true'` value, while `isScreenshotMode()` /
// `screenshotLanguage()` are asserted against the committed `.env`, which
// carries NEITHER key — so production defaults (mode off, language 'en') are
// what those wrappers must return here.
describe('parseScreenshotMode', () => {
  it('is true only for the exact string "true"', () => {
    expect(parseScreenshotMode('true')).toBe(true);
  });

  it('is false when the value is undefined (key absent from .env)', () => {
    expect(parseScreenshotMode(undefined)).toBe(false);
  });

  it('is false for any other value, including "false" and "1"', () => {
    expect(parseScreenshotMode('false')).toBe(false);
    expect(parseScreenshotMode('1')).toBe(false);
    expect(parseScreenshotMode('TRUE')).toBe(false);
    expect(parseScreenshotMode('')).toBe(false);
  });
});

describe('parseScreenshotLanguage', () => {
  it('returns the value when it is a supported language', () => {
    expect(parseScreenshotLanguage('en')).toBe('en');
    expect(parseScreenshotLanguage('uk')).toBe('uk');
  });

  it('defaults to "en" when the value is undefined (key absent)', () => {
    expect(parseScreenshotLanguage(undefined)).toBe('en');
  });

  it('defaults to "en" for any unsupported value', () => {
    expect(parseScreenshotLanguage('fr')).toBe('en');
    expect(parseScreenshotLanguage('EN')).toBe('en');
    expect(parseScreenshotLanguage('')).toBe('en');
  });
});

describe('isScreenshotMode', () => {
  it('is false under the committed .env (no SCREENSHOT_MODE key) — production stays unchanged', () => {
    expect(isScreenshotMode()).toBe(false);
  });
});

describe('screenshotLanguage', () => {
  it('defaults to "en" under the committed .env (no SCREENSHOT_LANG key)', () => {
    expect(screenshotLanguage()).toBe('en');
  });
});
