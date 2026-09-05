import { match } from 'ts-pattern';

import { binanceProvider, defaultBinanceDeps } from './binance/binance.provider';
import { bitcoinWalletProvider, defaultBitcoinWalletDeps } from './btc-wallet/btc-wallet.provider';
import { type BalanceSyncResult, runBalanceSync } from './sync';

/**
 * One user-triggered crypto sync. `address` is set only by the wallet Connect
 * action — a re-sync reads the stored `metadata.walletAddress` instead.
 */
export type CryptoSyncRequest =
  | { providerId: 'btc_wallet'; targetAccountId: string; address?: string }
  | { providerId: 'binance'; targetAccountId: string };

/** Pick the concrete provider for the request and run the generic balance sync. */
export const runCryptoSync = (request: CryptoSyncRequest): Promise<BalanceSyncResult> =>
  match(request)
    .with({ providerId: 'btc_wallet' }, ({ targetAccountId, address }) =>
      runBalanceSync(
        bitcoinWalletProvider,
        { ...defaultBitcoinWalletDeps, address },
        { targetAccountId },
      ),
    )
    .with({ providerId: 'binance' }, ({ targetAccountId }) =>
      runBalanceSync(binanceProvider, defaultBinanceDeps, { targetAccountId }),
    )
    .exhaustive();
