import type { TFunction } from 'i18next';
import { match } from 'ts-pattern';

import type { HoldingRow } from '../../db/schema';
import type { ExchangeMetadataField } from '../../holdings/holding-metadata';

/**
 * The single source of truth for the balance-provider ids. Each id doubles as
 * the `accounts.institution` value of an account connected to that provider,
 * and as a `transactions.source` literal.
 */
export const balanceProviderIds = ['btc_wallet', 'binance'] as const;

export type BalanceProviderId = (typeof balanceProviderIds)[number];

export const isBalanceProviderId = (value: string | null): value is BalanceProviderId =>
  value !== null && (balanceProviderIds as readonly string[]).includes(value);

// Title-case display name used in UI copy. 'Binance' is a brand name and
// reads the same in every language, so its catalog entry is identical
// English/Ukrainian text (the same convention every other Binance-branded
// string in the catalog already follows) — routed through the catalog
// anyway, both for the one genuinely-translated 'Wallet' case and so a
// future rename only touches the catalog, not this call site.
export const providerDisplayName = (providerId: BalanceProviderId, t: TFunction): string =>
  match(providerId)
    .with('btc_wallet', () => t('accountDetail.wallet'))
    .with('binance', () => t('accountDetail.binance'))
    .exhaustive();

export type ProviderBalance = {
  /** Satoshis. */
  balanceMinorUnits: number;
  /**
   * Provider-specific key used to match/upsert the target holding: the wallet
   * address itself, or the fixed 'BTC' asset code for Binance.
   */
  metadataKey: string;
  /**
   * Display name for the holding the first sync inserts. An existing holding
   * keeps its (possibly user-edited) name — the upsert never rewrites it, EXCEPT
   * the one-time transition rename below.
   */
  name: string;
  /**
   * One-time transition rename. When set, the upsert rewrites an EXISTING
   * matched holding's name to `name` ONLY IF its current name still equals this
   * exact string (the old default). A user-edited name never matches, so it is
   * preserved. Binance's Spot balance sets this to the pre-split default
   * ('Binance BTC') so a legacy aggregated holding is relabeled to 'Binance
   * Spot' on the first post-split sync; every other provider omits it.
   */
  renameFromDefault?: string;
};

/**
 * The account a sync writes into, with its current holdings so a provider can
 * read a stored key (the wallet address) back on a re-sync.
 */
export type SyncTarget = { accountId: string; holdings: HoldingRow[] };

export interface BalanceProvider<Deps> {
  id: BalanceProviderId;
  /** The `holdings.metadata` field the provider's `metadataKey` is stored under. */
  metadataField: ExchangeMetadataField;
  fetchBalances: (deps: Deps, target: SyncTarget) => Promise<ProviderBalance[]>;
}
