import either, { bifold, isLeft } from 'fnts/either';
import { match } from 'ts-pattern';

import { binanceProvider, defaultBinanceDeps } from '../binance/binance.provider';
import { syncBinanceTransactions } from '../binance/binance.transactions';
import { bitcoinWalletProvider, defaultBitcoinWalletDeps } from '../btc-wallet/btc-wallet.provider';
import { type BalanceSyncResult, runBalanceSync } from '../sync';

/**
 * One user-triggered crypto sync. `address` is set only by the wallet Connect
 * action — a re-sync reads the stored `metadata.walletAddress` instead.
 */
export type CryptoSyncRequest =
  | { providerId: 'btc_wallet'; targetAccountId: string; address?: string }
  | { providerId: 'binance'; targetAccountId: string };

const runBinanceSyncAndImport = async (targetAccountId: string): Promise<BalanceSyncResult> => {
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
};

/**
 * Per-account single-flight join over the WHOLE Binance arm (balance sync
 * AND the transaction-history import that follows it), mirroring
 * `inFlightBalanceSyncs` in `src/crypto-sync/sync/sync.ts`. `runBalanceSync`
 * is already per-account locked, but that lock releases before the
 * transaction import runs — an account-detail Connect overlapping a
 * pull-to-refresh fan-out for the SAME account could still re-run
 * `syncBinanceTransactions` a second time. Joining here instead means a
 * second overlapping trigger never re-enters `runBalanceSync` at all, so its
 * own lock stays a no-op for this caller — the outer join already serializes
 * per account. The check and set are SYNCHRONOUS (no `await` before the map
 * is written), so two overlapping triggers cannot both slip past into their
 * own run; the lock releases the instant the run settles — success OR
 * failure — so a later, non-overlapping sync starts fresh.
 */
const inFlightBinanceSyncs = new Map<string, Promise<BalanceSyncResult>>();

const runBinanceSyncOnce = (targetAccountId: string): Promise<BalanceSyncResult> => {
  const joined = inFlightBinanceSyncs.get(targetAccountId);

  if (joined) {
    return joined;
  }
  const run = runBinanceSyncAndImport(targetAccountId);
  inFlightBinanceSyncs.set(targetAccountId, run);
  const release = (): void => {
    if (inFlightBinanceSyncs.get(targetAccountId) === run) {
      inFlightBinanceSyncs.delete(targetAccountId);
    }
  };
  run.then(release, release);

  return run;
};

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
    .with({ providerId: 'binance' }, ({ targetAccountId }) => runBinanceSyncOnce(targetAccountId))
    .exhaustive();
