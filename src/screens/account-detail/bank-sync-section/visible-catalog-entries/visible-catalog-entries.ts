import { bankProviderRegistry } from '@kiko/bank-sync/registry';
import { type ProviderCatalogEntry, providerCatalog } from '@kiko/bank-sync/provider-catalog';

/**
 * The rows the "Add a bank" sheet offers: every `providerCatalog` entry that
 * has a wired `bankProviderRegistry` entry (a catalog entry with no registry
 * wiring yet is described but not yet connectable, so it stays filtered out).
 * No build flag gates the list: a provider that is not safe to connect must not
 * be in the catalog at all (Guideline 2.5.19), not merely hidden here.
 */
const visibleCatalogEntries = (): ProviderCatalogEntry[] =>
  providerCatalog.filter((entry) => bankProviderRegistry[entry.id] !== undefined);

export default visibleCatalogEntries;
