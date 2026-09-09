import either, { bifold, isLeft } from 'fnts/either';
import { match } from 'ts-pattern';

import { binanceProvider, defaultBinanceDeps } from './binance/binance.provider';
import { syncBinanceTransactions } from './binance/binance.transactions';
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
    .with({ providerId: 'binance' }, async ({ targetAccountId }) => {
      const result = await runBalanceSync(binanceProvider, defaultBinanceDeps, { targetAccountId });
      // The transaction-history import is SUPPLEMENTARY to the balance sync and
      // runs after it (the Spot holding must exist first). Its failure — a 429,
      // a permission gap — must NOT fail the balance sync, so it is captured as
      // an Either and only logged. The balance result is returned regardless.
      const imported = await either(() => syncBinanceTransactions({ targetAccountId }));

      if (isLeft(imported)) {
        // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) the balance sync succeeded; log that this run could not import its Binance transaction history so a device log shows what was dropped.
        console.warn('[binance sync] transaction history import failed', bifold(imported));
      }

      return result;
    })
    .exhaustive();
