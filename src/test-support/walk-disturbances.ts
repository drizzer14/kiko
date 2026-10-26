/**
 * The disturbances a property test puts on the first runs of a Binance history walk, and the loop
 * that drives the runs: a random part of the lane is spent before a run, a window throws on some
 * runs, some reads answer a 429 (which starts the cooldown, and a run inside it sends nothing).
 * The last runs are quiet, so a walk that loses nothing ends current.
 */
import {
  type BinanceHistoryRun,
  BinanceRateLimitError,
  createBinanceHistoryRun,
  isBinanceCoolingDown,
  LANE_CALL_CAPS,
  setBinanceCooldownUntil,
} from '@kiko/crypto-sync/binance';
import { DAY_MS } from '@kiko/dates';

import type { Random } from './seeded-random';

type Lane = 'p2p' | 'fiatOrders' | 'fiatPayments';

type WindowThrower = { run: number; at: number; error: Error };

export type Disturbances = {
  noisyRuns: number;
  /** The calls of the lane spent before each run. */
  spent: number[];
  throwers: WindowThrower[];
  random: Random;
};

/** The run a walk is in: set by `walkRuns`, read by the fake read of the test. */
export type CurrentRun = { run: number; now: number };

export const disturbancesOf = (input: {
  random: Random;
  runs: number;
  noisyRuns: number;
  lane: Lane;
  /** A thrower window sits at a day between `from` and `from` plus `days` days. */
  from: number;
  days: number;
  /** The error a throwing window throws, made fresh for the run it throws in. */
  errorOf: (run: number) => Error;
}): Disturbances => {
  const { random, runs, noisyRuns, lane, from, days, errorOf } = input;

  return {
    noisyRuns,
    spent: Array.from({ length: runs }, (_unused, run) =>
      run < noisyRuns ? Math.floor(random() * (LANE_CALL_CAPS[lane] + 1)) : 0,
    ),
    throwers: Array.from({ length: noisyRuns }, (_unused, run) => run)
      .filter(() => random() < 0.3)
      .map((run) => ({
        run,
        at: from + Math.floor(random() * days) * DAY_MS,
        error: errorOf(run),
      })),
    random,
  };
};

/** What a read of `span` in the current run fails with, if anything. */
export const readFailureOf = (
  disturbances: Disturbances,
  current: CurrentRun,
  span: { start: number; end: number },
): Error | undefined => {
  const { noisyRuns, throwers, random } = disturbances;
  const thrower = throwers.find(({ run }) => run === current.run);

  if (thrower !== undefined && span.start <= thrower.at && thrower.at <= span.end) {
    return thrower.error;
  }

  return current.run < noisyRuns && random() < 0.08
    ? new BinanceRateLimitError(429, 1 + Math.floor(random() * 3 * DAY_MS))
    : undefined;
};

type RunStep = { run: number; runNow: number; walkRun: BinanceHistoryRun };

/**
 * Drive `runs` runs a clock gap apart, `current` telling the fake read which one it is in. Each
 * run is checked to stay within the lane (less what the disturbance spent) and to send nothing
 * inside the cooldown; an error a thrower window raised is the one the run may fail with.
 * `afterRun` checks what the test holds after each run.
 */
export const walkRuns = async <Result>(input: {
  runs: number;
  gapMs: number;
  firstRunAt: number;
  accountId: string;
  lane: Lane;
  disturbances: Disturbances;
  current: CurrentRun;
  /** How many reads the fake has answered so far. */
  reads: () => number;
  walk: (step: RunStep) => Promise<Result>;
  afterRun: (run: number, runNow: number) => void;
}): Promise<{ last: Result | undefined; finalClock: number }> => {
  const { runs, gapMs, firstRunAt, accountId, lane, disturbances, current } = input;
  let last: Result | undefined;

  for (current.run = 0; current.run < runs; current.run += 1) {
    const { run } = current;

    current.now = firstRunAt + run * gapMs;

    if (run === disturbances.noisyRuns) {
      setBinanceCooldownUntil(accountId, 0);
    }

    const walkRun = createBinanceHistoryRun({
      now: () => current.now,
      sleep: async () => undefined,
    });

    for (let call = 0; call < disturbances.spent[run]; call += 1) {
      walkRun.budget.record(lane, { usedUidWeight1m: undefined, usedIpWeight1m: undefined });
    }

    const cooling = isBinanceCoolingDown(accountId, current.now);
    const readsBefore = input.reads();

    try {
      last = await input.walk({ run, runNow: current.now, walkRun });
    } catch (error) {
      if (!disturbances.throwers.some((thrower) => thrower.error === error)) {
        throw error;
      }
    }

    expect(input.reads() - readsBefore).toBeLessThanOrEqual(
      LANE_CALL_CAPS[lane] - disturbances.spent[run],
    );
    expect(cooling ? input.reads() - readsBefore : 0).toBe(0);
    input.afterRun(run, current.now);
  }

  return { last, finalClock: current.now };
};
