import {
  createExchangeRun,
  type ExchangeRun,
  type RunBudget,
} from '@kiko/crypto-sync/exchange/budget';

import type { BinancePageWeights } from './binance.history-client';

/**
 * One lane per walk, so a long backfill in one walk cannot starve the others. The
 * capital walk has two: its withdraw reads are the expensive ones, its deposit
 * reads are not. `dust` is no walk: one read of the newest records per run, so its cap is 1.
 * `market` is the public price reads of `src/rates/binance-market/`. `tradeSymbols` is the one
 * public `exchangeInfo` read per run that lists the symbols a trade read can walk.
 */
export type BudgetLane =
  | 'capitalWithdraw'
  | 'capitalDeposit'
  | 'pay'
  | 'transfer'
  | 'earn'
  | 'convert'
  | 'dust'
  | 'market'
  | 'tradeSymbols';

/**
 * What one request adds to Binance's per-minute count: UID weight, SAPI IP weight or `/api/*` IP
 * weight, never more than one. The `/api/*` endpoints count against their own IP limit, so they
 * carry their own reading.
 */
export type CallCost = { uid: number } | { ip: number } | { api: number };

/**
 * Binance's own per-minute UID weight ceiling — what `X-SAPI-USED-UID-WEIGHT-1M` is
 * measured against.
 */
export const UID_WEIGHT_BUDGET_1M = 180_000;

/**
 * Half of the assumed 12,000 per-minute IP ceiling, so another app on the same
 * network keeps room.
 */
export const IP_BUDGET_1M = 6_000;

/**
 * Half of the 6000 per-minute IP limit the `/api/*` endpoints share (`X-MBX-USED-WEIGHT-1M`), so
 * the account reads and the public price reads of one IP keep room for each other.
 */
export const API_IP_BUDGET_1M = 3_000;

/**
 * The inter-request pacing interval for the whole history run. A first sync fans out
 * many windows across several endpoints; fired back-to-back they can trip a Binance
 * weight-429. Small: a background import, not Monobank's 60 second statement limit.
 */
export const BINANCE_REQUEST_INTERVAL_MS = 350;

/**
 * The per-run call cap of each lane. It applies unconditionally, whether or not
 * Binance reports a weight header: the header can only tighten the budget further,
 * never loosen it past the cap. Deposit reads cost one IP weight and are bounded by
 * the IP reading alone.
 */
export const LANE_CALL_CAPS: Record<BudgetLane, number> = {
  capitalWithdraw: 9,
  capitalDeposit: Infinity,
  pay: 20,
  transfer: 80,
  earn: 30,
  convert: 20,
  dust: 1,
  market: 150,
  tradeSymbols: 1,
};

/**
 * The calls of each lane beyond its cap that a span read may spend while it narrows or reads the
 * band its read began above (see `readSeriesSpan`): a Binance that keeps less than the 179 days
 * asked has each of the 20 Transfer types find its own depth in the span that crosses it, and the
 * ground just above the depth is lost to a type that is read in a later run. Only those calls come
 * from here, so a run that narrows nothing spends `LANE_CALL_CAPS` alone, and the cap stays whole
 * for the reads that follow. The Convert lane has none: it does not narrow, a start Binance
 * refuses fails the run, as Pay's does.
 * Every such call is judged by the weight reading as any other.
 */
export const LANE_NARROWING_CALLS: Record<BudgetLane, number> = {
  capitalWithdraw: 0,
  capitalDeposit: 0,
  pay: 0,
  transfer: 397,
  earn: 0,
  convert: 0,
  dust: 0,
  market: 0,
  tradeSymbols: 0,
};

/** The documented weight of one call to each endpoint. */
export const COSTS = {
  withdraw: { uid: 18_000 },
  deposit: { ip: 1 },
  pay: { uid: 3_000 },
  account: { ip: 20 },
  transfer: { ip: 1 },
  earn: { ip: 150 },
  convert: { uid: 3_000 },
  dust: { ip: 1 },
  klines: { api: 2 },
  exchangeInfo: { api: 20 },
} as const satisfies Record<string, CallCost>;

export type BinanceRunBudget = RunBudget<BudgetLane, CallCost, BinancePageWeights>;

/**
 * One budget per Binance arm run. A response without a header keeps the last
 * reading, so a missing header never reads as an empty minute.
 */
export const createBinanceRunBudget = (): BinanceRunBudget => {
  const callsByLane: Record<BudgetLane, number> = {
    capitalWithdraw: 0,
    capitalDeposit: 0,
    pay: 0,
    transfer: 0,
    earn: 0,
    convert: 0,
    dust: 0,
    market: 0,
    tradeSymbols: 0,
  };
  const narrowingCallsByLane: Record<BudgetLane, number> = {
    capitalWithdraw: 0,
    capitalDeposit: 0,
    pay: 0,
    transfer: 0,
    earn: 0,
    convert: 0,
    dust: 0,
    market: 0,
    tradeSymbols: 0,
  };
  let usedUidWeight: number | undefined;
  let usedIpWeight: number | undefined;
  let usedApiWeight: number | undefined;

  /** Whether a call is drawn from the lane's narrowing calls rather than its cap. */
  const isNarrowingCall = (lane: BudgetLane, narrowing: boolean): boolean =>
    narrowing && narrowingCallsByLane[lane] < LANE_NARROWING_CALLS[lane];

  return {
    canAfford: (lane, cost, keep = 0, narrowing = false) => {
      if (!isNarrowingCall(lane, narrowing) && callsByLane[lane] + keep >= LANE_CALL_CAPS[lane]) {
        return false;
      }

      if ('uid' in cost) {
        return (
          usedUidWeight === undefined ||
          usedUidWeight + cost.uid * (keep + 1) <= UID_WEIGHT_BUDGET_1M
        );
      }

      if ('api' in cost) {
        return (
          usedApiWeight === undefined || usedApiWeight + cost.api * (keep + 1) <= API_IP_BUDGET_1M
        );
      }

      return usedIpWeight === undefined || usedIpWeight + cost.ip * (keep + 1) <= IP_BUDGET_1M;
    },
    record: (lane, page, narrowing = false) => {
      if (isNarrowingCall(lane, narrowing)) {
        narrowingCallsByLane[lane] += 1;
      } else {
        callsByLane[lane] += 1;
      }

      usedUidWeight = page.usedUidWeight1m ?? usedUidWeight;
      usedIpWeight = page.usedIpWeight1m ?? usedIpWeight;
      usedApiWeight = page.usedApiWeight1m ?? usedApiWeight;
    },
  };
};

/** The pacing gate and the weight budget every walk of one Binance arm run shares. */
export type BinanceHistoryRun = ExchangeRun<BudgetLane, CallCost, BinancePageWeights>;

export const createBinanceHistoryRun = (clock: {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}): BinanceHistoryRun =>
  createExchangeRun({
    intervalMs: BINANCE_REQUEST_INTERVAL_MS,
    clock,
    budget: createBinanceRunBudget(),
  });
