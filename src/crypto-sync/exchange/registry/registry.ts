import type { ParseKeys } from 'i18next';
import type { BalanceProviderId } from '@kiko/crypto-sync/provider';

export type ExchangeProviderEntry = {
  id: BalanceProviderId;
  displayNameKey: ParseKeys;
  disconnectMessageKey: ParseKeys;
  // The note under a holding of this provider that names what its sync never lists. Absent for a
  // provider with nothing to name, and the holding detail then shows no footer for it.
  notListedKey?: ParseKeys;
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
  },
};
