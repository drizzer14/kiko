import { hasToken } from '../../monobank/token';
import type { BankProviderId } from '../provider';
import { providerCatalog } from '../provider-catalog';
import { disconnectBunq } from '../../bunq/disconnect';
import { runSync as bunqRunSync } from '../../bunq/sync';
import { disconnectMonobank } from '../../monobank/disconnect';
import type { ProviderCatalogEntry } from '../provider-catalog';
import { runSync as monobankRunSync } from '../../monobank/sync';
import { disconnectPrivatbank } from '../../privatbank/disconnect';
import { runSync as privatbankRunSync } from '../../privatbank/sync';
import { hasCredentials as hasBunqCredentials } from '../../bunq/credentials';
import { hasCredentials as hasPrivatbankCredentials } from '../../privatbank/credentials';

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
 */
export const bankProviderRegistry: Partial<Record<BankProviderId, BankProviderRegistryEntry>> = {
  monobank: {
    id: 'monobank',
    catalog: catalogEntryFor('monobank'),
    runSync: monobankRunSync,
    hasCredentials: hasToken,
    disconnect: disconnectMonobank,
  },
  privatbank: {
    id: 'privatbank',
    catalog: catalogEntryFor('privatbank'),
    runSync: privatbankRunSync,
    hasCredentials: hasPrivatbankCredentials,
    disconnect: disconnectPrivatbank,
  },
  bunq: {
    id: 'bunq',
    catalog: catalogEntryFor('bunq'),
    runSync: bunqRunSync,
    hasCredentials: hasBunqCredentials,
    disconnect: disconnectBunq,
  },
};
