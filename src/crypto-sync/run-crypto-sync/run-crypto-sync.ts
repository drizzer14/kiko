import { match } from 'ts-pattern';
import {
  BinanceWalkStop,
  EXCHANGE_STATE_MALFORMED,
  exchangeStateDepsOf,
} from '@kiko/crypto-sync/exchange/walk';
import { logFailure, logOnFailure } from '@kiko/diagnostics';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

import {
  bybitProvider,
  createBybitHistoryRun,
  defaultBybitDeps,
  syncBybitCapitalHistory,
} from '../bybit';
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
  | { providerId: 'binance'; targetAccountId: string }
  | { providerId: 'bybit'; targetAccountId: string };

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
 * failure — so a later, non-overlapping sync starts fresh. A Connect checks
 * `isBinanceSyncRunning` first, because this join would hand it a run that holds the old pair.
 */
const inFlightBinanceSyncs = new Map<string, Promise<BalanceSyncResult>>();

const inFlightBybitSyncs = new Map<string, Promise<BalanceSyncResult>>();

export const isBinanceSyncRunning = (accountId: string): boolean =>
  inFlightBinanceSyncs.has(accountId);

const joinedOrStarted = (
  inFlight: Map<string, Promise<BalanceSyncResult>>,
  targetAccountId: string,
  start: (targetAccountId: string) => Promise<BalanceSyncResult>,
): Promise<BalanceSyncResult> => {
  const joined = inFlight.get(targetAccountId);

  if (joined) {
    return joined;
  }
  const run = start(targetAccountId);
  inFlight.set(targetAccountId, run);
  const release = (): void => {
    if (inFlight.get(targetAccountId) === run) {
      inFlight.delete(targetAccountId);
    }
  };
  run.then(release, release);

  return run;
};

const runBinanceSyncOnce = (targetAccountId: string): Promise<BalanceSyncResult> =>
  joinedOrStarted(inFlightBinanceSyncs, targetAccountId, runBinanceSyncAndImport);

/**
 * The Bybit arm: the balance sync, the write of the lists it read, then the capital history walk.
 * The join covers all of it, with the same per-account key as Binance's.
 */
const runBybitSyncAndWrite = async (targetAccountId: string): Promise<BalanceSyncResult> => {
  const { syncedHoldings, exchangeState } = await runBalanceSync(bybitProvider, defaultBybitDeps, {
    targetAccountId,
  });

  // Written here, not by the read, for the reason of Binance's arm: the write finds the account
  // connected to Bybit only once the sync has marked it. A failed write only logs.
  if (exchangeState !== undefined) {
    await logOnFailure('[bybit sync] balance lists failed', () =>
      exchangeStateDepsOf('bybit').patchExchangeState(targetAccountId, exchangeState),
    );
  }

  // One gate and one call budget for every history walk of this run. The walk is supplementary to
  // the balance sync, which has written the Funding wallets it reads, so a failure of the walk is
  // only logged.
  const run = createBybitHistoryRun({ now: () => Date.now(), sleep });

  await logOnFailure('[bybit sync] capital history failed', () =>
    syncBybitCapitalHistory({ targetAccountId, run }),
  );

  return { syncedHoldings };
};

const runBybitSyncOnce = (targetAccountId: string): Promise<BalanceSyncResult> =>
  joinedOrStarted(inFlightBybitSyncs, targetAccountId, runBybitSyncAndWrite);

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
    .with({ providerId: 'bybit' }, ({ targetAccountId }) => runBybitSyncOnce(targetAccountId))
    .exhaustive();
