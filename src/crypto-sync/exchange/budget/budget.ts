import { createRequestGate, type RequestGate } from '@kiko/monobank/throttle';

/**
 * The weight budget of one exchange run, over the lanes (`Lane`) its walks read in. An exchange
 * brings its own cost and reading shapes, because each limits requests its own way.
 */
export type RunBudget<Lane extends string, Cost, Weights> = {
  /**
   * Whether the lane can make this call and still `keep` more of the same cost, so a pass
   * that comes later in a run keeps the calls it needs. A `narrowing` call is affordable while the
   * lane has narrowing calls left, whatever is kept; the weight reading judges it as any other.
   */
  canAfford: (lane: Lane, cost: Cost, keep?: number, narrowing?: boolean) => boolean;
  /** A `narrowing` call is counted against the lane's narrowing calls first, then its cap. */
  record: (lane: Lane, page: Weights, narrowing?: boolean) => void;
};

/** The pacing gate and the weight budget every walk of one exchange run shares. */
export type ExchangeRun<Lane extends string, Cost, Weights> = {
  gate: RequestGate;
  budget: RunBudget<Lane, Cost, Weights>;
};

export const createExchangeRun = <Lane extends string, Cost, Weights>(input: {
  intervalMs: number;
  clock: { now: () => number; sleep: (milliseconds: number) => Promise<void> };
  budget: RunBudget<Lane, Cost, Weights>;
}): ExchangeRun<Lane, Cost, Weights> => ({
  gate: createRequestGate({
    intervalMs: input.intervalMs,
    now: input.clock.now,
    sleep: input.clock.sleep,
  }),
  budget: input.budget,
});
