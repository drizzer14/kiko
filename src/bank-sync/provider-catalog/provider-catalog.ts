import type { BankProviderId } from '../provider';

/** How the app authenticates to this provider. */
export type ConnectionMethod = 'stored-token' | 'consent-flow';

/** Whether one connection yields exactly one bank, or can yield several. */
export type ProviderShape = 'single-bank' | 'multi-bank';

/**
 * Every entry's about/dataProvided/eligibility key lives under
 * `addBank.<id>.<field>` in `src/i18n/locales/{en,uk}.ts`. Deriving the key
 * type from `BankProviderId` (rather than a bare `string`) makes a typo or a
 * key for a provider not in `bankProviderIds` a compile error, and lets
 * `i18n.t(entry.aboutKey)` type-check against the real translation catalog.
 */
type AddBankCopyField = 'about' | 'dataProvided' | 'eligibility';
type AddBankTranslationKey = `addBank.${BankProviderId}.${AddBankCopyField}`;

export type ProviderCatalogEntry = {
  id: BankProviderId;
  /** Title shown on the catalog row, e.g. 'Monobank'. */
  displayName: string;
  /** (a) Which bank/API this is, in plain language. i18n key, 1 sentence. */
  aboutKey: AddBankTranslationKey;
  connectionMethod: ConnectionMethod;
  shape: ProviderShape;
  /** (b) What data it provides and how it connects/refreshes. i18n key. */
  dataProvidedKey: AddBankTranslationKey;
  /** (c) Who it works for, stated plainly. i18n key. */
  eligibilityKey: AddBankTranslationKey;
  /**
   * Country/bank coverage, shown only for a multi-bank provider — a
   * single-bank provider's coverage is implicit in its `aboutKey`. No entry
   * below is multi-bank yet, so none sets this.
   */
  coverage?: { countries: string[]; bankCount?: string };
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
    connectionMethod: 'stored-token',
    shape: 'single-bank',
    aboutKey: 'addBank.monobank.about',
    dataProvidedKey: 'addBank.monobank.dataProvided',
    eligibilityKey: 'addBank.monobank.eligibility',
  },
];
