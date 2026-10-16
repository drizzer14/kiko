import { match } from 'ts-pattern';
import { logOnFailure } from '@kiko/diagnostics';

import {
  binanceProvider,
  createBinanceHistoryRun,
  defaultBinanceDeps,
  syncBinanceEarnHistory,
  syncBinancePayHistory,
  syncBinanceTransactions,
  syncBinanceTransferHistory,
} from '../binance';
import { type BalanceSyncResult, runBalanceSync } from '../sync';
import { bitcoinWalletProvider, defaultBitcoinWalletDeps } from '../btc-wallet';

/**
 * One user-triggered crypto sync. `address` is set only by the wallet Connect
 * action — a re-sync reads the stored `metadata.walletAddress` instead.
 */
export type CryptoSyncRequest =
  | { providerId: 'btc_wallet'; targetAccountId: string; address?: string }
  | { providerId: 'binance'; targetAccountId: string };

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const runBinanceSyncAndImport = async (targetAccountId: string): Promise<BalanceSyncResult> => {
  const result = await runBalanceSync(binanceProvider, defaultBinanceDeps, { targetAccountId });
  // One gate and one weight budget for every history walk of this run, so the walks
  // together stay under Binance's per-minute limits.
  const run = createBinanceHistoryRun({ now: () => Date.now(), sleep });

  // The history walks are SUPPLEMENTARY to the balance sync and run after it (the
  // Spot holding must exist first). A failure — a 429, a permission gap — must NOT
  // fail the balance sync, so it is only logged. The balance result is returned
  // regardless.
  await logOnFailure('[binance sync] capital history failed', () =>
    syncBinanceTransactions({ targetAccountId, run }),
  );
  // After the capital walk: the Pay walk does not read the capital cursor, and the order
  // fixes which walk a shared rate limit (the cooldown) skips.
  await logOnFailure('[binance sync] pay history failed', () =>
    syncBinancePayHistory({ targetAccountId, run }),
  );
  // After the Pay walk, so a rate limit either walk met (the shared cooldown) skips this one.
  await logOnFailure('[binance sync] transfer history failed', () =>
    syncBinanceTransferHistory({ targetAccountId, run }),
  );
  // Last, so a rate limit any earlier walk met (the shared cooldown) skips this one too.
  await logOnFailure('[binance sync] earn history failed', () =>
    syncBinanceEarnHistory({ targetAccountId, run }),
  );

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
