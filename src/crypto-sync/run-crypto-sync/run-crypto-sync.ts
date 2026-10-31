import { match } from 'ts-pattern';
import {
  BinanceWalkStop,
  EXCHANGE_STATE_MALFORMED,
  exchangeStateDepsOf,
} from '@kiko/crypto-sync/exchange/walk';
import { logFailure, logOnFailure } from '@kiko/diagnostics';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

import {
  type BinanceHistoryRun,
  binanceProvider,
  createBinanceHistoryRun,
  defaultBinanceDeps,
  syncBinanceDustHistory,
  syncBinanceEarnHistory,
  syncBinancePayHistory,
  syncBinanceP2pHistory,
  syncBinanceTransactions,
  syncBinanceConvertHistory,
  syncBinanceTradeHistory,
  syncBinanceFiatOrderHistory,
  syncBinanceTransferHistory,
  syncBinanceFiatPaymentHistory,
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

const runBinanceHistoryWalks = async (
  targetAccountId: string,
  run: BinanceHistoryRun,
  spotBalanceTexts: BalanceSyncResult['spotBalanceTexts'],
): Promise<void> => {
  // Read once, for the whole run: a state this build cannot read is no state a walk can write
  // to, so every walk would start from its floor again on every run. A read that fails is
  // logged by the caller, and skips the walks too.
  const stateText = await exchangeStateDepsOf('binance').readExchangeState(targetAccountId);

  if (parseExchangeState(stateText).kind === 'malformed') {
    logFailure(
      '[binance sync] walk state unreadable',
      new BinanceWalkStop(EXCHANGE_STATE_MALFORMED),
    );

    return;
  }

  // First, each walk in its own failure log: P2P's whole share of the minute is its own lane cap,
  // so running it before every other walk keeps that share from being spent first, and a P2P page
  // that cannot be read rejects its walk on every run while the walks after it still run.
  await logOnFailure('[binance sync] p2p history failed', () =>
    syncBinanceP2pHistory({ targetAccountId, run }),
  );
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
  await logOnFailure('[binance sync] earn history failed', () =>
    syncBinanceEarnHistory({ targetAccountId, run }),
  );
  await logOnFailure('[binance sync] convert history failed', () =>
    syncBinanceConvertHistory({ targetAccountId, run }),
  );
  await logOnFailure('[binance sync] dust history failed', () =>
    syncBinanceDustHistory({ targetAccountId, run }),
  );
  await logOnFailure('[binance sync] fiat order history failed', () =>
    syncBinanceFiatOrderHistory({ targetAccountId, run }),
  );
  await logOnFailure('[binance sync] fiat payment history failed', () =>
    syncBinanceFiatPaymentHistory({ targetAccountId, run }),
  );
  // Last, so a rate limit any earlier walk met (the shared cooldown) skips this one too, and
  // with the Spot texts of this run's balance read, which decide the order it reads symbols in.
  await logOnFailure('[binance sync] trade history failed', () =>
    syncBinanceTradeHistory({ targetAccountId, run, spotBalanceTexts }),
  );
};

const runBinanceSyncAndImport = async (targetAccountId: string): Promise<BalanceSyncResult> => {
  const { syncedHoldings, exchangeState, spotBalanceTexts } = await runBalanceSync(
    binanceProvider,
    defaultBinanceDeps,
    { targetAccountId },
  );

  // Written here, not by the read: the write finds the account connected to Binance only once
  // the sync has marked it, which a first Connect does after the read. A failed write must not
  // fail the balance sync, so it is only logged.
  if (exchangeState !== undefined) {
    await logOnFailure('[binance sync] balance lists failed', () =>
      exchangeStateDepsOf('binance').patchExchangeState(targetAccountId, exchangeState),
    );
  }

  // One gate and one weight budget for every history walk of this run, so the walks
  // together stay under Binance's per-minute limits.
  const run = createBinanceHistoryRun({ now: () => Date.now(), sleep });

  // The history walks are SUPPLEMENTARY to the balance sync and run after it (the
  // Spot holding must exist first). A failure — a 429, a permission gap, a state that cannot
  // be read — must NOT fail the balance sync, so it is only logged. The balance result is
  // returned regardless.
  await logOnFailure('[binance sync] walk state read failed', () =>
    runBinanceHistoryWalks(targetAccountId, run, spotBalanceTexts),
  );

  return { syncedHoldings };
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
