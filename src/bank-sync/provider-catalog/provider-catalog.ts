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
   * Release-readiness gate (whole-branch review, item E). `false` means the
   * provider is not yet safe to offer a real user in a RELEASE build (e.g.
   * bunq's node-forge crypto binding (`src/bunq/crypto/node-forge-crypto.ts`)
   * is wired and unit-tested, but the handshake itself still needs a manual
   * sandbox/real-account network check before this flips to `true`;
   * PrivatBank's wire shapes are still `TODO(VERIFY LIVE)` throughout
   * `src/privatbank/`). `AddBankProviderSheet` hides a `false` entry UNLESS
   * the `SHOW_UNREADY_BANKS` build flag is on, so a TEST build can still
   * exercise the honest graceful-fail/fail-closed states end to end while a
   * RELEASE build never lets a real user pick a not-ready bank.
   */
  connectReady: boolean;
  /**
   * Country/bank coverage, shown only for a multi-bank provider — a
   * single-bank provider's coverage is implicit in its `aboutKey`. No entry
   * below is multi-bank yet, so none sets this.
   */
  coverage?: { countries: string[]; bankCount?: string };
};

export const providerCatalog: ProviderCatalogEntry[] = [
  {
    id: 'monobank',
    displayName: 'Monobank',
    connectionMethod: 'stored-token',
    shape: 'single-bank',
    aboutKey: 'addBank.monobank.about',
    dataProvidedKey: 'addBank.monobank.dataProvided',
    eligibilityKey: 'addBank.monobank.eligibility',
    connectReady: true,
  },
  {
    id: 'privatbank',
    displayName: 'PrivatBank',
    connectionMethod: 'stored-token',
    shape: 'single-bank',
    aboutKey: 'addBank.privatbank.about',
    dataProvidedKey: 'addBank.privatbank.dataProvided',
    eligibilityKey: 'addBank.privatbank.eligibility',
    connectReady: false,
  },
  {
    id: 'bunq',
    displayName: 'bunq',
    connectionMethod: 'stored-token',
    shape: 'single-bank',
    aboutKey: 'addBank.bunq.about',
    dataProvidedKey: 'addBank.bunq.dataProvided',
    eligibilityKey: 'addBank.bunq.eligibility',
    connectReady: false,
  },
  {
    id: 'starling',
    displayName: 'Starling',
    connectionMethod: 'stored-token',
    shape: 'single-bank',
    aboutKey: 'addBank.starling.about',
    dataProvidedKey: 'addBank.starling.dataProvided',
    eligibilityKey: 'addBank.starling.eligibility',
    connectReady: true,
  },
];
