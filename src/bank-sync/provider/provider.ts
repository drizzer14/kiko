import type { Currency } from '../../currency/currency';

/**
 * The single source of truth for the NATIVE bank-provider ids. Each id doubles
 * as the `accounts.institution` value of an account connected to that
 * provider, and as a `transactions.source` literal. NATIVE-ONLY: there is
 * deliberately no aggregator id here — every provider currently wired is a
 * single stored-credential bank.
 */
export const bankProviderIds = ['monobank', 'privatbank', 'bunq', 'starling'] as const;

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

export type ProviderInstitution = {
  /**
   * The provider's own bank id, e.g. an aggregator's 'REVOLUT_REVOGB21'.
   * Absent for a single-bank provider (there is only ever one).
   */
  externalInstitutionId?: string;
  name: string;
  /** ISO 3166-1 alpha-2, e.g. 'PL'. Absent for a single-bank provider (Ukraine is implicit). */
  countryCode?: string;
};

export type ProviderAccount = {
  externalAccountId: string;
  institution: ProviderInstitution;
  kind: 'card' | 'jar' | 'account';
  name: string;
  /** `undefined` = a currency Kiko cannot represent; caller skips it (mirrors `isUnrepresentableCurrency`). */
  currency: Currency | undefined;
  balanceMinorUnits: number;
  iban?: string;
  maskedPan?: string;
};

export type ProviderStatementItem = {
  externalAccountId: string;
  externalStatementId: string;
  amountMinorUnits: number;
  timeSeconds: number;
  description?: string;
  mcc?: number;
  hold?: boolean;
  counterIban?: string;
  comment?: string;
};

export interface BankProvider<Credentials, Deps> {
  id: BankProviderId;
  /**
   * 'single-bank': Monobank/PrivatBank — one stored credential targets one
   * already-existing Kiko Account (`targetAccountId`), same as today.
   * 'multi-bank': an aggregator — one credential/connection can surface
   * accounts across SEVERAL institutions; the sync engine creates one Kiko
   * Account PER distinct `ProviderInstitution` it has not seen before, never
   * merging two banks under one Account.
   */
  shape: 'single-bank' | 'multi-bank';
  /** `null` when the API has no meaningful per-credential rate limit. */
  rateLimit: { intervalMs: number } | null;
  /** The API's max statement window, for windowed paging (mirrors `MAX_WINDOW_SECONDS`). */
  maxWindowSeconds: number;
  fetchAccounts: (deps: Deps, credentials: Credentials) => Promise<ProviderAccount[]>;
  fetchStatement: (
    deps: Deps,
    credentials: Credentials,
    externalAccountId: string,
    fromSeconds: number,
    toSeconds: number,
  ) => Promise<ProviderStatementItem[]>;
}
