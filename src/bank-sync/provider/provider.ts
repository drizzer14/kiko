/**
 * The single source of truth for the NATIVE bank-provider ids. Each id doubles
 * as the `accounts.institution` value of an account connected to that
 * provider, and as a `transactions.source` literal. NATIVE-ONLY: there is
 * deliberately no aggregator id here — every provider currently wired is a
 * single stored-credential bank.
 *
 * Guideline 5.6 remediation (App Store rejection: "features intentionally
 * hidden during review"): PrivatBank, bunq, and Starling bank-CONNECT were
 * REMOVED from the app entirely, not flag-hidden — Monobank is the sole
 * shipped provider. The registry ARCHITECTURE stays (this tuple, the
 * catalog, and `bankProviderRegistry` are still generic over
 * `BankProviderId`), so a future provider is a one-line addition here again.
 */
export const bankProviderIds = ['monobank'] as const;

export type BankProviderId = (typeof bankProviderIds)[number];

/**
 * Strips a multi-bank provider's `<providerId>:<externalInstitutionId>`
 * suffix. No provider wired today is multi-bank, but a future one may be, so
 * this split stays generic — a single-bank id round-trips through it
 * unchanged (`bankProviderIdOf('monobank') === 'monobank'`).
 */
export const bankProviderIdOf = (institution: string): string => institution.split(':', 1)[0];

export const isBankProviderId = (value: string | null): value is BankProviderId =>
  value !== null && (bankProviderIds as readonly string[]).includes(bankProviderIdOf(value));
