import type { ParseKeys } from 'i18next';
import type { BalanceProviderId } from '@kiko/crypto-sync/provider';

export type ExchangeProviderEntry = {
  id: BalanceProviderId;
  displayNameKey: ParseKeys;
  disconnectMessageKey: ParseKeys;
  // The note under a holding of this provider that names what its sync never lists. Absent for a
  // provider with nothing to name, and the holding detail then shows no footer for it.
  notListedKey?: ParseKeys;
  // Whether the holding detail shows the balance beyond the rows as "Earlier history". Set only
  // where the rows and the balance read the same wallet: a provider whose rows name no wallet
  // (Bybit) would show a wrong amount, often below zero.
  showsEarlierHistory?: true;
  // The line under the net-worth chart that names what this provider's past cannot hold. Absent
  // for a provider with nothing to add to the chart.
  pastLimitsKey?: ParseKeys;
};

/**
 * Ties a `BalanceProviderId` to the copy of its connection, so `syncJobsFor`, the
 * display name and the Disconnect confirm never hardcode a provider list. Partial,
 * like `bankProviderRegistry`: an id in `balanceProviderIds` with no entry here is
 * not wired, and its callers skip it, never assume every id resolves. Imports the
 * provider TYPES only, because `providerDisplayName` reads this registry back.
 */
export const exchangeProviderRegistry: Partial<Record<BalanceProviderId, ExchangeProviderEntry>> = {
  btc_wallet: {
    id: 'btc_wallet',
    displayNameKey: 'accountDetail.wallet',
    disconnectMessageKey: 'accountDetail.disconnectProviderMessage.wallet',
  },
  binance: {
    id: 'binance',
    displayNameKey: 'accountDetail.binance',
    disconnectMessageKey: 'accountDetail.disconnectProviderMessage.binance',
    notListedKey: 'holdingDetail.exchangeNotListed.binance',
    showsEarlierHistory: true,
  },
  bybit: {
    id: 'bybit',
    displayNameKey: 'accountDetail.bybit',
    disconnectMessageKey: 'accountDetail.disconnectProviderMessage.bybit',
    notListedKey: 'holdingDetail.exchangeNotListed.bybit',
    pastLimitsKey: 'statistics.bybitPastLimits',
  },
};

/**
 * The past-limits line of each provider that has one and appears in `institutions`, once per
 * provider however many accounts connect to it. An institution that names no provider adds none.
 */
export const pastLimitsKeysOf = (institutions: readonly (string | null)[]): ParseKeys[] =>
  Object.values(exchangeProviderRegistry).flatMap((entry) =>
    entry?.pastLimitsKey !== undefined && institutions.includes(entry.id)
      ? [entry.pastLimitsKey]
      : [],
  );
