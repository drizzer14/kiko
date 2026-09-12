import type { HoldingRow } from '../../db/schema';
import { walletAddressOf } from '../../holdings/holding-metadata';
import type { BalanceProvider } from '../provider';

import { isValidBitcoinAddress } from './bitcoin-address';
import { fetchAddressBalance } from './btc-wallet.client';

export type BitcoinWalletDeps = {
  fetchImpl: typeof fetch;
  fetchAddressBalance: (address: string, fetchImpl?: typeof fetch) => Promise<number>;
  /**
   * The address to connect (the Connect action). Absent on a re-sync, where the
   * address stored in the holding's `metadata.walletAddress` is read instead.
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

const storedAddress = (holdings: HoldingRow[]): string | undefined =>
  holdings
    .map((holding) => walletAddressOf(holding.metadata))
    .find((address) => address !== undefined);

export const bitcoinWalletProvider: BalanceProvider<BitcoinWalletDeps> = {
  id: 'btc_wallet',
  metadataField: 'walletAddress',
  fetchBalances: async (deps, target) => {
    const address = (deps.address ?? storedAddress(target.holdings))?.trim();

    if (address === undefined) {
      throw new Error('No wallet address stored; connect a wallet before syncing');
    }

    if (!isValidBitcoinAddress(address)) {
      throw new Error('Invalid BTC address');
    }

    const balanceMinorUnits = await deps.fetchAddressBalance(address, deps.fetchImpl);

    return [{ balanceMinorUnits, metadataKey: address, name: WALLET_HOLDING_NAME }];
  },
};
