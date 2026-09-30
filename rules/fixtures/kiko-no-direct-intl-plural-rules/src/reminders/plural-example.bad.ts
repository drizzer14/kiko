// Semgrep fixture (POSITIVE): Hermes on iOS has no `Intl.PluralRules`, so a
// direct use outside `src/i18n/plural-rules/` either crashes on the device or
// meets the minimal fallback that only covers the shipped languages' cardinal
// rules. `kiko-no-direct-intl-plural-rules` MUST report a finding on each
// pinned line below. Never "fix" this file — plurals go through i18next's
// `count`, and plural rules themselves live in `src/i18n/plural-rules/`.

// EXPECT-FINDING
const rules = new Intl.PluralRules('uk');

// EXPECT-FINDING
export const supported = Intl.PluralRules.supportedLocalesOf(['uk', 'en']);

// EXPECT-FINDING
export const hasPluralRules = typeof globalThis.Intl.PluralRules === 'function';

// EXPECT-FINDING
const { PluralRules } = Intl;

// EXPECT-FINDING
export const bracketed = Intl['PluralRules'];

// EXPECT-FINDING
export const globalBracketed = globalThis['Intl'].PluralRules;

// EXPECT-FINDING
const { PluralRules: Rules } = Intl;

export const category = rules.select(2);
export const ordinal = new PluralRules('en', { type: 'ordinal' });
export const renamed = new Rules('uk');

export const reassignable = () => {
  // EXPECT-FINDING
  let { PluralRules } = Intl;

  PluralRules = Intl.NumberFormat as never;

  return PluralRules;
};

export const firstOfTwo = () => {
  // EXPECT-FINDING
  const { PluralRules, NumberFormat } = Intl;

  return [PluralRules, NumberFormat];
};

export const lastOfTwo = () => {
  // EXPECT-FINDING
  const { NumberFormat, PluralRules } = Intl;

  return [NumberFormat, PluralRules];
};
