import { createBinanceHistoryRun } from './binance.history-budget';

/**
 * A clock that every wait of a run gate advances (and the test, by the latency of each request it
 * answers), with a fresh run on it for each call.
 */
export const movingClockOf = (startMs: number) => {
  const clock = { now: startMs };
  const newRun = () =>
    createBinanceHistoryRun({
      now: () => clock.now,
      sleep: async (milliseconds) => {
        clock.now += milliseconds;
      },
    });

  return { clock, newRun };
};

/** Latencies that differ from request to request, 0 to 300 ms, the same on every test run. */
export const jitterMs = (): (() => number) => {
  let seed = 7;

  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;

    return seed % 301;
  };
};
