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
  transfer: 80,
  earn: 30,
};

/**
 * The calls of each lane beyond its cap that a span read may spend while it narrows or reads the
 * band its read began above (see `readSeriesSpan`): a Binance that keeps less than the 179 days
 * asked has each of the 20 Transfer types find its own depth in the span that crosses it, and the
 * ground just above the depth is lost to a type that is read in a later run. Only those calls come
 * from here, so a run that narrows nothing spends `LANE_CALL_CAPS` alone, and the cap stays whole
 * for the reads that follow.
 * Every such call is judged by the weight reading as any other.
 */
export const LANE_NARROWING_CALLS: Record<BudgetLane, number> = {
  capitalWithdraw: 0,
  capitalDeposit: 0,
  pay: 0,
  transfer: 397,
  earn: 0,
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
  /**
   * Whether the lane can make this call and still `keep` more of the same cost, so a pass
   * that comes later in a run keeps the calls it needs. A `narrowing` call is affordable while the
   * lane has narrowing calls left (`LANE_NARROWING_CALLS`), whatever is kept; the weight reading
   * judges it as any other.
   */
  canAfford: (lane: BudgetLane, cost: CallCost, keep?: number, narrowing?: boolean) => boolean;
  /** A `narrowing` call is counted against the lane's narrowing calls first, then its cap. */
  record: (
    lane: BudgetLane,
    page: { usedUidWeight1m: number | undefined; usedIpWeight1m: number | undefined },
    narrowing?: boolean,
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
  const narrowingCallsByLane: Record<BudgetLane, number> = {
    capitalWithdraw: 0,
    capitalDeposit: 0,
    pay: 0,
    transfer: 0,
    earn: 0,
  };
  let usedUidWeight: number | undefined;
  let usedIpWeight: number | undefined;

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
