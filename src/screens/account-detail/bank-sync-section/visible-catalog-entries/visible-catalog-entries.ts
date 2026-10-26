import { bankProviderRegistry } from '@kiko/bank-sync/registry';
import { type ProviderCatalogEntry, providerCatalog } from '@kiko/bank-sync/provider-catalog';

/**
 * The rows the "Add a bank" sheet offers: every `providerCatalog` entry that
 * has a wired `bankProviderRegistry` entry (a catalog entry with no registry
 * wiring yet is described but not yet connectable, so it stays filtered out).
 * Guideline 2.3.1(a) remediation (App Store rejection: "features intentionally
 * hidden during review"): the sheet shows the full wired catalog
 * UNCONDITIONALLY now — there is no release-readiness build flag anymore.
 * A not-yet-safe-to-connect provider must never ship in the app AT ALL
 * (removed from `src/bank-sync/provider-catalog/`, not merely hidden here);
 * see that module's own doc comment. A test asserts the resolved rows directly.
 */
const visibleCatalogEntries = (): ProviderCatalogEntry[] =>
  providerCatalog.filter((entry) => bankProviderRegistry[entry.id] !== undefined);

export default visibleCatalogEntries;
