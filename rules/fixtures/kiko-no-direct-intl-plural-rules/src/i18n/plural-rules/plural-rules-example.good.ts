// Semgrep fixture (NEGATIVE): `src/i18n/plural-rules/` is the one place that
// may touch `Intl.PluralRules` — it installs the Hermes fallback there, so
// `kiko-no-direct-intl-plural-rules` must not match this file.

export const hasPluralRules = (): boolean => typeof Intl.PluralRules === 'function';
