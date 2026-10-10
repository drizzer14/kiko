import { createRequestGate, type RequestGate } from '@kiko/monobank/throttle';

/**
 * One lane per walk, so a long backfill in one walk cannot starve the others. The
 * capital walk has two: its withdraw reads are the expensive ones, its deposit
 * reads are not.
 */
export type BudgetLane = 'capitalWithdraw' | 'capitalDeposit' | 'pay' | 'transfer' | 'earn';

/** What one request adds to Binance's per-minute count: UID weight or IP weight, never both. */
export type CallCost = { uid: number } | { ip: number };

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
  transfer: 60,
  earn: 30,
};

/** The documented weight of one call to each endpoint. */
export const COSTS = {
  withdraw: { uid: 18_000 },
  deposit: { ip: 1 },
  pay: { uid: 3_000 },
  account: { ip: 20 },
  transfer: { ip: 1 },
  earn: { ip: 150 },
} as const satisfies Record<string, CallCost>;

export type BinanceRunBudget = {
  canAfford: (lane: BudgetLane, cost: CallCost) => boolean;
  record: (
    lane: BudgetLane,
    page: { usedUidWeight1m: number | undefined; usedIpWeight1m: number | undefined },
  ) => void;
};

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
  };
  let usedUidWeight: number | undefined;
  let usedIpWeight: number | undefined;

  return {
    canAfford: (lane, cost) => {
      if (callsByLane[lane] >= LANE_CALL_CAPS[lane]) {
        return false;
      }

      if ('uid' in cost) {
        return usedUidWeight === undefined || usedUidWeight + cost.uid <= UID_WEIGHT_BUDGET_1M;
      }

      return usedIpWeight === undefined || usedIpWeight + cost.ip <= IP_BUDGET_1M;
    },
    record: (lane, page) => {
      callsByLane[lane] += 1;
      usedUidWeight = page.usedUidWeight1m ?? usedUidWeight;
      usedIpWeight = page.usedIpWeight1m ?? usedIpWeight;
    },
  };
};

/** The pacing gate and the weight budget every walk of one Binance arm run shares. */
export type BinanceHistoryRun = { gate: RequestGate; budget: BinanceRunBudget };

export const createBinanceHistoryRun = (clock: {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}): BinanceHistoryRun => ({
  gate: createRequestGate({
    intervalMs: BINANCE_REQUEST_INTERVAL_MS,
    now: clock.now,
    sleep: clock.sleep,
  }),
  budget: createBinanceRunBudget(),
});
