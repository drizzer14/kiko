import type { TFunction } from 'i18next';
import { match } from 'ts-pattern';

import type { HoldingRow } from '../db/schema';
import type { ExchangeMetadataField } from '../holdings/holding-metadata';

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
  /**
   * Always 'BTC' in this milestone; kept as a field, not hardcoded inline, so a
   * later multi-asset provider only widens this type.
   */
  currency: 'BTC';
  /** Satoshis. */
  balanceMinorUnits: number;
  /**
   * Provider-specific key used to match/upsert the target holding: the wallet
   * address itself, or the fixed 'BTC' asset code for Binance.
   */
  metadataKey: string;
  /**
   * Display name for the holding the first sync inserts. An existing holding
   * keeps its (possibly user-edited) name — the upsert never rewrites it.
   */
  name: string;
};

/**
 * The account a sync writes into, with its current holdings so a provider can
 * read a stored key (the wallet address) back on a re-sync.
 */
export type SyncTarget = { accountId: string; holdings: HoldingRow[] };

export interface BalanceProvider<Deps> {
  id: BalanceProviderId;
  /**
   * 'exchange' holds a secret in the Keychain; 'wallet' holds only a public
   * key in metadata. Reserved for provider-family branching (credential
   * handling, copy) as more providers land.
   */
  kind: 'exchange' | 'wallet';
  /** The `holdings.metadata` field the provider's `metadataKey` is stored under. */
  metadataField: ExchangeMetadataField;
  fetchBalances: (deps: Deps, target: SyncTarget) => Promise<ProviderBalance[]>;
}
