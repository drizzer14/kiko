import { i18n } from '@kiko/i18n/init';
import type { HoldingRow } from '@kiko/db';
import { walletAddressOf } from '@kiko/holdings/holding-metadata';

import type { BalanceProvider, ProviderBalance } from '../provider';

import { isValidBitcoinAddress } from './bitcoin-address';
import { fetchAddressBalance } from './btc-wallet.client';

export type BitcoinWalletDeps = {
  fetchImpl: typeof fetch;
  fetchAddressBalance: (address: string, fetchImpl?: typeof fetch) => Promise<number>;
  /**
   * The address to connect (the Connect action), synced first. Every open holding's
   * `metadata.walletAddress` is synced too, so a re-sync (no address) covers them all.
   * A public address is not a secret, so nothing here touches the Keychain.
   */
  address?: string;
};

export const defaultBitcoinWalletDeps: BitcoinWalletDeps = {
  fetchImpl: fetch,
  fetchAddressBalance,
};

/** Display name of the holding the first sync creates. */
const WALLET_HOLDING_NAME = 'BTC Wallet';

// A closed holding is a decision to stop tracking, and its address would otherwise go to a
// third party on every sync. The upsert never reopens a row, so a connect-time address that
// belongs to a closed holding refreshes that hidden row and nothing more.
const addressesToSync = (connectAddress: string | undefined, holdings: HoldingRow[]): string[] => {
  const addresses = [
    connectAddress,
    ...holdings
      .filter(({ closedAt }) => closedAt === null)
      .map(({ metadata }) => walletAddressOf(metadata)),
  ].filter((address): address is string => address !== undefined);

  return [...new Set(addresses.map((address) => address.trim()))];
};

export const bitcoinWalletProvider: BalanceProvider<BitcoinWalletDeps> = {
  id: 'btc_wallet',
  metadataField: 'walletAddress',
  fetchBalances: async (deps, target) => {
    const addresses = addressesToSync(deps.address, target.holdings);

    if (addresses.length === 0) {
      // A wallet whose every stored address was closed has nothing left to track: the
      // orchestrator writes nothing for an empty result, so only a wallet that never stored
      // an address is an error.
      if (target.holdings.some(({ metadata }) => walletAddressOf(metadata) !== undefined)) {
        return [];
      }

      throw new Error(i18n.t('accountDetail.noWalletAddressStored'));
    }

    // Every address is checked before the first request, so a stored address that fails the
    // check sends nothing to the explorer.
    if (!addresses.every(isValidBitcoinAddress)) {
      throw new Error(i18n.t('accountDetail.invalidBTCAddress'));
    }

    const balances: ProviderBalance[] = [];

    // One request in flight and a throw on the first failure: the orchestrator upserts only
    // after this returns, so a failed address leaves every stored balance as it was.
    for (const address of addresses) {
      balances.push({
        balanceMinorUnits: await deps.fetchAddressBalance(address, deps.fetchImpl),
        metadataKey: address,
        name: WALLET_HOLDING_NAME,
      });
    }

    return balances;
  },
};
