import type { BankProviderId } from '../provider';

/**
 * Every entry's about/eligibility key lives under `addBank.<id>.<field>` in
 * `src/i18n/locales/{en,uk}.ts`. Deriving the key type from `BankProviderId`
 * (rather than a bare `string`) makes a typo or a key for a provider not in
 * `bankProviderIds` a compile error, and lets `i18n.t(entry.aboutKey)`
 * type-check against the real translation catalog.
 */
type AddBankCopyField = 'about' | 'eligibility';
type AddBankTranslationKey = `addBank.${BankProviderId}.${AddBankCopyField}`;

export type ProviderCatalogEntry = {
  id: BankProviderId;
  /** Title shown on the catalog row, e.g. 'Monobank'. */
  displayName: string;
  /** (a) Which bank/API this is, in plain language. i18n key, 1 sentence. */
  aboutKey: AddBankTranslationKey;
  /** (c) Who it works for, stated plainly. i18n key. */
  eligibilityKey: AddBankTranslationKey;
};

// Guideline 5.6 remediation (App Store rejection: "features intentionally
// hidden during review"): PrivatBank, bunq, and Starling entries were
// REMOVED — Monobank is the sole shipped provider. Their bank-CONNECT code
// (src/{privatbank,bunq,starling}/) was deleted, not flag-hidden; the
// registry architecture stays so a future provider is a new entry again.
export const providerCatalog: ProviderCatalogEntry[] = [
  {
    id: 'monobank',
    displayName: 'Monobank',
    aboutKey: 'addBank.monobank.about',
    eligibilityKey: 'addBank.monobank.eligibility',
  },
];
