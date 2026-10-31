import type { ParseKeys, TFunction } from 'i18next';
import { isBalanceProviderId } from '@kiko/crypto-sync/provider';
import { exchangeProviderRegistry } from '@kiko/crypto-sync/exchange/registry';

/**
 * The "which exchange or wallet is this crypto account" catalog, stored in
 * `accounts.bankId` of a crypto account. `connectable` is plain, always-visible
 * data on a fully-rendered static array, never a build or runtime visibility gate
 * (Guideline 2.5.19): every entry always renders, and only the affordance differs.
 * `other` is LAST: it names no exchange, so it is added by hand.
 */
const exchangeCatalogIds = ['binance', 'btc_wallet', 'other'] as const;

export type ExchangeCatalogId = (typeof exchangeCatalogIds)[number];

type ExchangeCatalogEntryBase = {
  id: ExchangeCatalogId;
  /** Whether the entry connects live (an API key or a public address), or adds holdings by hand. */
  connectable: boolean;
  /** The capability caption under the entry's name. */
  captionKey: ParseKeys;
};

// A brand name reads the same in every language, so it is plain text; the rest are translated.
type ExchangeCatalogEntry = ExchangeCatalogEntryBase &
  (
    | { displayName: string; labelKey?: undefined }
    | { labelKey: ParseKeys; displayName?: undefined }
  );

export const exchangeCatalog: readonly ExchangeCatalogEntry[] = [
  {
    id: 'binance',
    displayName: 'Binance',
    connectable: true,
    captionKey: 'forms.account.exchangeConnectable',
  },
  {
    id: 'btc_wallet',
    labelKey: 'forms.account.bitcoinWallet',
    connectable: true,
    captionKey: 'forms.account.walletConnectable',
  },
  {
    id: 'other',
    labelKey: 'forms.account.exchangeOther',
    connectable: false,
    captionKey: 'forms.account.exchangeOtherCaption',
  },
];

const isExchangeCatalogId = (value: string | null): value is ExchangeCatalogId =>
  value !== null && (exchangeCatalogIds as readonly string[]).includes(value);

/** The entry's name as the user reads it. */
export const exchangeLabelOf = (entry: ExchangeCatalogEntry, t: TFunction): string =>
  entry.displayName ?? t(entry.labelKey);

/**
 * A crypto account's catalog id: its stored bank id when that is a catalog id, else its
 * institution when that is one (an account connected before the catalog existed has no bank id),
 * else null.
 */
export const exchangeCatalogIdOf = ({
  bankId,
  institution,
}: {
  bankId: string | null;
  institution: string | null;
}): ExchangeCatalogId | null => {
  if (isExchangeCatalogId(bankId)) {
    return bankId;
  }

  return isExchangeCatalogId(institution) ? institution : null;
};

/**
 * The entries a connect sheet offers: connectable AND wired in the exchange registry, so an entry
 * with no sync behind it is described but never offered.
 */
export const visibleExchangeEntries = (): ExchangeCatalogEntry[] =>
  exchangeCatalog.filter(
    (entry) =>
      entry.connectable &&
      isBalanceProviderId(entry.id) &&
      exchangeProviderRegistry[entry.id] !== undefined,
  );
