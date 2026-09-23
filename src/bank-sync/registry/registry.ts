import { hasToken } from '../../monobank/token';
import type { BankProviderId } from '../provider';
import { providerCatalog } from '../provider-catalog';
import { disconnectMonobank } from '../../monobank/disconnect';
import type { ProviderCatalogEntry } from '../provider-catalog';
import { runSync as monobankRunSync } from '../../monobank/sync';

export type BankProviderRegistryEntry = {
  id: BankProviderId;
  catalog: ProviderCatalogEntry;
  runSync: (overrides?: { targetAccountId?: string }) => Promise<{ importedTransactions: number }>;
  hasCredentials: (accountId: string) => Promise<boolean>;
  disconnect: (accountId: string) => Promise<void>;
};

const catalogEntryFor = (id: BankProviderId): ProviderCatalogEntry => {
  const entry = providerCatalog.find((candidate) => candidate.id === id);

  if (!entry) {
    throw new Error(`provider-catalog is missing its "${id}" entry`);
  }

  return entry;
};

/**
 * Ties a `BankProviderId` to its concrete `runSync`/credential functions, so
 * `syncJobsFor` and the account-detail screen never hardcode a provider list.
 * Partial: an id in `bankProviderIds` with no entry here is simply not yet
 * implemented — its sync/connect/disconnect callers must skip it, never
 * assume every native id resolves.
 *
 * Guideline 5.6 remediation: PrivatBank, bunq, and Starling entries were
 * REMOVED (their code is deleted, not flag-hidden) — Monobank is the sole
 * shipped provider. This `Partial<Record<...>>` shape stays exactly as it
 * was, so a future provider is a new entry here again.
 */
export const bankProviderRegistry: Partial<Record<BankProviderId, BankProviderRegistryEntry>> = {
  monobank: {
    id: 'monobank',
    catalog: catalogEntryFor('monobank'),
    runSync: monobankRunSync,
    hasCredentials: hasToken,
    disconnect: disconnectMonobank,
  },
};
