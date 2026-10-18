import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import type { HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import type { ExchangeMetadataField } from '@kiko/holdings/holding-metadata';

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
  /** The currency the balance and the holding it writes are in. */
  currency: Currency;
  /** Minor units of `currency`. */
  balanceMinorUnits: number;
  /**
   * Provider-specific key the sync matches and upserts the target holding by:
   * the wallet address itself, or the fixed 'BTC' asset code for Binance.
   */
  metadataKey: string;
  /**
   * Display name for the holding the first sync inserts. An existing holding
   * keeps its (possibly user-edited) name — the upsert never rewrites it, EXCEPT
   * the once-per-holding transition rename below.
   */
  name: string;
  /**
   * Transition rename, once per holding. When set, the FIRST upsert of a holding
   * rewrites an EXISTING matched holding's name to `name` ONLY IF its current
   * name equals one of these exact strings, and marks the holding whether or not
   * it renamed it; no later upsert renames it again, so a name the user sets
   * afterwards, even one of these strings, is preserved. Binance's BTC balances
   * set this to the earlier default names of their wallet (Spot: 'Binance BTC'
   * and 'Binance Spot') so a stored holding is relabeled to
   * 'Binance <Wallet> · BTC'; every other provider omits it.
   */
  renameFromDefaults?: readonly string[];
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
