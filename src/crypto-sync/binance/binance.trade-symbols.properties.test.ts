import type { ExchangeTrades } from '@kiko/crypto-sync/exchange/walk-state';

import {
  planTradeSymbolReads,
  runTradeSymbolReads,
  tradesPatchesOf,
} from './binance.trade-symbols';

/** A seeded generator (Lehmer), so a failing run replays. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state * 48_271) % 2_147_483_647;

    return state / 2_147_483_647;
  };
};

const SEEDS = Array.from({ length: 100 }, (_unused, position) => 1 + position * 13);

const MOST_LISTED = 150;
const UNIVERSE = 600;
const PHASES = 3;
const THROW_SHARE = 0.05;

type Candidate = { symbol: string; baseAsset: string; quoteAsset: string };

const candidateOf = (index: number): Candidate => {
  const base = `C${String(index).padStart(4, '0')}`;

  return { symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT' };
};

const bySymbol = (left: Candidate, right: Candidate): number =>
  Number(left.symbol > right.symbol) - Number(left.symbol < right.symbol);

const countIn = (random: () => number, most: number): number => 1 + Math.floor(random() * most);

/** The listed symbols of the next phase: some of the last ones stay, the rest are new. */
const churnedListing = (
  random: () => number,
  listed: Candidate[],
  rotation: string,
): Candidate[] => {
  const target = countIn(random, MOST_LISTED);
  const kept = listed
    .filter(() => random() < 0.5)
    .filter(({ symbol }) => symbol !== rotation || random() < 0.5)
    .slice(0, target);
  const taken = new Set(kept.map(({ symbol }) => symbol));
  const added: Candidate[] = [];

  for (let index = 0; kept.length + added.length < target && index < UNIVERSE; index += 1) {
    const fresh = candidateOf((index * 7 + Math.floor(random() * 7)) % UNIVERSE);

    if (!taken.has(fresh.symbol)) {
      taken.add(fresh.symbol);
      added.push(fresh);
    }
  }

  return [...kept, ...added].sort(bySymbol);
};

type RunWorld = {
  trades: ExchangeTrades;
  balanceTexts: Record<string, string>;
};

/** Held, never read and changed symbols drawn afresh each run, so any mix reaches the planner. */
const worldOf = (
  random: () => number,
  candidates: Candidate[],
  rotation: string,
  changedShare: number,
  runNumber: number,
): RunWorld => {
  const coins = [...new Set(candidates.flatMap((c) => [c.baseAsset, c.quoteAsset]))];
  const balanceTexts = Object.fromEntries(coins.map((coin) => [coin, `${runNumber}/0`]));
  const balanceSnapshot = Object.fromEntries(
    coins.map((coin) => [coin, random() < changedShare ? 'old/0' : balanceTexts[coin]]),
  );
  const entries = candidates.flatMap(
    ({ symbol }): [string, ExchangeTrades['symbols'][string]][] => {
      const roll = random();

      if (roll < 0.1) {
        return [[symbol, { fromId: 5, heldOrderId: 9 }]];
      }

      return roll < 0.2 ? [] : [[symbol, { fromId: 1 }]];
    },
  );

  return {
    trades: { symbols: Object.fromEntries(entries), rotation, balanceSnapshot },
    balanceTexts,
  };
};

type RunOutcome = { started: string[]; rotation: string; failed: boolean };

/** One run of the rotation as a caller drives it: plan, read, then the patch of the rotation. */
const playRun = async (input: {
  random: () => number;
  candidates: Candidate[];
  rotation: string;
  changedShare: number;
  runNumber: number;
}): Promise<RunOutcome> => {
  const { random, candidates, rotation, changedShare, runNumber } = input;
  const world = worldOf(random, candidates, rotation, changedShare, runNumber);
  const plan = planTradeSymbolReads({ candidates, ...world });
  const cap = countIn(random, 100);
  const started: string[] = [];
  let spent = 0;

  const result = await runTradeSymbolReads({
    plan,
    canAfford: (keep) => spent + keep < cap,
    readSymbol: async (symbol, keep) => {
      const wanted = countIn(random, 3);
      let calls = 0;

      started.push(symbol);

      while (calls < wanted && spent + keep < cap) {
        spent += 1;
        calls += 1;

        if (random() < THROW_SHARE) {
          throw new Error('request failed');
        }
      }

      return { ended: calls < wanted ? 'budget' : 'short-page' };
    },
  });
  const patches = tradesPatchesOf({ candidates, ...world, result });
  const moved = patches.flatMap((patch) => (patch.kind === 'tradesRotation' ? [patch.value] : []));

  return {
    started,
    rotation: moved.at(-1) ?? rotation,
    failed: result.failure !== undefined,
  };
};

/**
 * How many symbols of the sorted list the rotation passed, counted from the symbol text it began
 * after, so a rotation that names a symbol absent from the list still has a place in it.
 */
const advanceOf = (candidates: Candidate[], before: string, after: string): number => {
  if (before === after) {
    return 0;
  }

  const beforeIndex = candidates.filter(({ symbol }) => symbol <= before).length - 1;
  const afterIndex = candidates.findIndex(({ symbol }) => symbol === after);
  const steps = (afterIndex - beforeIndex + candidates.length) % candidates.length;

  return steps === 0 ? candidates.length : steps;
};

/** Runs over one fixed list until each symbol of it has started a read; asserts the bound. */
const playPhase = async (input: {
  random: () => number;
  candidates: Candidate[];
  rotation: string;
  changedShare: number;
  firstRunNumber: number;
}): Promise<{ rotation: string; runs: number }> => {
  const { random, candidates, changedShare, firstRunNumber } = input;
  const unstarted = new Set(candidates.map(({ symbol }) => symbol));
  let rotation = input.rotation;
  let passed = 0;
  let runs = 0;

  while (unstarted.size > 0) {
    expect(runs).toBeLessThan(3 * candidates.length + 30);

    const outcome = await playRun({
      random,
      candidates,
      rotation,
      changedShare,
      runNumber: firstRunNumber + runs,
    });
    const advance = advanceOf(candidates, rotation, outcome.rotation);

    // A run that reads every symbol on the priority alone has none left for the round-robin.
    if (!outcome.failed && outcome.started.length < candidates.length) {
      expect(advance).toBeGreaterThanOrEqual(1);
    }

    for (const symbol of outcome.started) {
      unstarted.delete(symbol);
    }

    passed += advance;
    runs += 1;
    rotation = outcome.rotation;

    if (passed >= candidates.length) {
      expect([...unstarted]).toEqual([]);
    }
  }

  return { rotation, runs };
};

describe('the rotation of the trade symbol reads over random lists', () => {
  it.each(SEEDS)(
    'starts every listed symbol within the runs the round-robin needs to circle the list, as the list churns (seed %d)',
    async (seed) => {
      const random = seededRandom(seed);
      const changedShare = random();
      let rotation = random() < 0.5 ? '' : candidateOf(Math.floor(random() * UNIVERSE)).symbol;
      let candidates = churnedListing(random, [], '');
      let runNumber = 0;

      for (let phase = 0; phase < PHASES; phase += 1) {
        const played = await playPhase({
          random,
          candidates,
          rotation,
          changedShare,
          firstRunNumber: runNumber,
        });

        rotation = played.rotation;
        runNumber += played.runs;
        candidates = churnedListing(random, candidates, rotation);
      }
    },
  );
});
