import {
  createExchangeRun,
  type ExchangeRun,
  type RunBudget,
} from '@kiko/crypto-sync/exchange/budget';

/**
 * One lane per walk, so a long backfill in one walk cannot starve the others: the capital walk
 * (deposits, internal transfers and withdrawals), the transfer walk, the account log, the convert
 * read and the Funding ledger.
 */
export type BybitLane = 'capital' | 'transfer' | 'log' | 'convert' | 'fundingLedger';

/**
 * Bybit limits each route on its own, and the gate interval holds the slowest one, so a call
 * carries no weight and a response is read for no weight. The same empty value is a call's cost,
 * the reading of a response and the reading of a refused call.
 */
export type BybitCallWeights = Record<string, never>;

export const NO_WEIGHTS: BybitCallWeights = {};

/**
 * The inter-request pacing interval for the whole run: 54.5 requests a minute at most, so the
 * slowest documented route (transfer, 60 a minute) holds under a fixed or a rolling minute.
 */
export const BYBIT_REQUEST_INTERVAL_MS = 1100;

/**
 * The per-run call cap of each lane. It is the only limit of a lane: no response header can
 * loosen or tighten it. Capital reads 3 series over 10 windows, transfer, log and the Funding
 * ledger 20 windows, and convert 10 pages.
 */
export const BYBIT_LANE_CALL_CAPS: Record<BybitLane, number> = {
  capital: 30,
  transfer: 20,
  log: 20,
  convert: 10,
  fundingLedger: 20,
};

export type BybitRunBudget = RunBudget<BybitLane, BybitCallWeights, BybitCallWeights>;

/** A fresh count per lane: the counters of two runs must never share an object. */
const noCallsByLane = (): Record<BybitLane, number> => ({
  capital: 0,
  transfer: 0,
  log: 0,
  convert: 0,
  fundingLedger: 0,
});

/**
 * One budget per Bybit arm run: calls per lane only. No lane has narrowing calls, so a call
 * recorded or asked as narrowing is held to the cap like any other.
 */
export const createBybitRunBudget = (): BybitRunBudget => {
  const callsByLane = noCallsByLane();

  return {
    canAfford: (lane, _cost, keep = 0) => callsByLane[lane] + keep < BYBIT_LANE_CALL_CAPS[lane],
    record: (lane) => {
      callsByLane[lane] += 1;
    },
  };
};

/** The pacing gate and the call budget every walk of one Bybit arm run shares. */
export type BybitHistoryRun = ExchangeRun<BybitLane, BybitCallWeights, BybitCallWeights>;

/**
 * A request that rejected was made all the same: it is a call of the lane that gave nothing to
 * read, so a lane's cap holds when its requests fail.
 */
export const recordBybitFailedCall = (run: BybitHistoryRun, lane: BybitLane): void =>
  run.budget.record(lane, NO_WEIGHTS);

export const createBybitHistoryRun = (clock: {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}): BybitHistoryRun =>
  createExchangeRun({
    intervalMs: BYBIT_REQUEST_INTERVAL_MS,
    clock,
    budget: createBybitRunBudget(),
  });
