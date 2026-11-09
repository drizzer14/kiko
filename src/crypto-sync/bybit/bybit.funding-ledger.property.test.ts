import { DAY_MS } from '@kiko/dates';
import { sweep } from '@kiko/test-support/property-sweep';
import type { FundingMatchRow, HoldingRow } from '@kiko/db';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import {
  type BybitFundingReconcileDeps,
  reconcileBybitFundingLedger,
} from './bybit.funding-reconcile';
import { NOW } from './bybit.client-test-fixtures';
import { ledgerRowOf, sourceRowOf } from './bybit.funding-test-fixtures';

// The production entry point of the reconcile runs over an in-memory store. Every record of a world
// arrives in a random order, and a reconcile runs twice after each arrival, as a run that stops at
// any commit would leave the stored set. A world's rows are the rows of its sources and the rows
// the reconcile writes for the ledger. Amounts are whole units of USDT.
const FULL_SEEDS = Array.from({ length: 120 }, (_unused, position) => 5 + position * 11);

const SEEDS = sweep(FULL_SEEDS);

// Small consecutive seeds of the Lehmer generator draw the same first value, so each seed is
// spread before it is used.
const SEED_SPREAD = 1_000_003;

const ACCOUNT = 'acc-1';
const HOUR_MS = 3_600_000;
const UNITS_PER_WHOLE = 100_000_000;
const SOURCE_AMOUNTS = [100, 100, 50, 20];
const AMOUNTS_APART = [7, 13, 29];
const FEE = 5;

type World = {
  sources: FundingMatchRow[];
  ledgers: FundingMatchRow[];
  /** The ledger rows that belong to a source: the rest are a credit or debit of their own. */
  ownKeys: Set<string>;
  /** The sources that have no ledger row, because they landed on another wallet. */
  aloneKeys: Set<string>;
  fees: number;
};

type Settings = {
  loneAmounts: readonly number[];
  withFees: boolean;
  withSourcesAlone: boolean;
  /** Every move goes this way when set: a double count then has one sign. */
  direction?: 'I' | 'O';
};

const pick = <Entry>(random: Random, entries: readonly Entry[]): Entry =>
  entries[Math.floor(random() * entries.length)] as Entry;

const timeOf = (random: Random): number =>
  NOW - 60 * DAY_MS + Math.floor(random() * 25) * DAY_MS + Math.floor(random() * 24) * HOUR_MS;

const signedOf = ({ direction, amount }: Pick<FundingMatchRow, 'direction' | 'amount'>): number =>
  (direction === 'O' ? -1 : 1) * Number(amount);

/** The ledger amount a source can show: its own amount, or one of the forms of its fee. */
const ledgerAmountOf = (
  random: Random,
  series: string,
  amount: number,
  hasFee: boolean,
): number => {
  if (!hasFee) {
    return amount;
  }

  return pick(
    random,
    series === 'deposit' ? [amount, amount - FEE, amount + FEE] : [amount, amount + FEE],
  );
};

const worldOf = (seed: number, settings: Settings): World => {
  const random = seededRandom(seed * SEED_SPREAD);
  const moveCount = 3 + Math.floor(random() * 7);
  const world: World = {
    sources: [],
    ledgers: [],
    ownKeys: new Set(),
    aloneKeys: new Set(),
    fees: 0,
  };

  for (let index = 0; index < moveCount; index += 1) {
    const kind = random();
    const series =
      settings.direction === undefined
        ? pick(random, ['deposit', 'deposit', 'withdraw'] as const)
        : ({ I: 'deposit', O: 'withdraw' } as const)[settings.direction];
    const amount = pick(random, SOURCE_AMOUNTS);
    const time = timeOf(random);

    if (kind < 0.25) {
      world.ledgers.push(
        ledgerRowOf(`${ACCOUNT}:funding:lone-${index}:USDT`, time, {
          amount: String(pick(random, settings.loneAmounts)),
          direction: settings.direction ?? pick(random, ['I', 'O']),
        }),
      );

      continue;
    }

    const hasFee = settings.withFees && random() < 0.5;
    const source = sourceRowOf(`${ACCOUNT}:${series}:source-${index}:USDT`, series, time, {
      amount: String(amount),
      fee: hasFee ? String(FEE) : null,
    });

    world.sources.push(source);

    if (settings.withSourcesAlone && kind < 0.4) {
      world.aloneKeys.add(source.recordKey);

      continue;
    }

    const own = ledgerRowOf(
      `${ACCOUNT}:funding:own-${index}:USDT`,
      time + Math.floor(random() * 6 * 24) * HOUR_MS,
      {
        amount: String(ledgerAmountOf(random, series, amount, hasFee)),
        direction: source.direction,
      },
    );

    world.ledgers.push(own);
    world.ownKeys.add(own.recordKey);
    world.fees += hasFee ? FEE : 0;
  }

  return world;
};

const shuffled = <Entry>(random: Random, entries: readonly Entry[]): Entry[] => {
  const copy = [...entries];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const held = copy[index] as Entry;

    copy[index] = copy[other] as Entry;
    copy[other] = held;
  }

  return copy;
};

const SETTLED_STATE = JSON.stringify({
  version: 1,
  walks: Object.fromEntries(
    ['capital', 'transfer', 'convert'].map((walk) => [walk, { cursor: NOW, pending: [] }]),
  ),
});

/** The rows the reconcile wrote, by key, with the minor units of each. */
type Written = Map<string, number>;

const depsOf = (
  stored: Map<string, FundingMatchRow>,
  written: Written,
): Partial<BybitFundingReconcileDeps> => {
  const holdings: HoldingRow[] = [];

  return {
    now: () => NOW,
    readExchangeState: async () => SETTLED_STATE,
    patchExchangeState: async () => undefined,
    listHoldings: async () => holdings,
    ensureHoldings: async (created) => {
      for (const holding of created) {
        holdings.push({
          id: `holding-${holding.metadataKey}`,
          metadata: { [holding.metadataField]: holding.metadataKey },
        } as unknown as HoldingRow);
      }
    },
    readStoredSet: async () => [...stored.values()],
    readWrittenKeys: async () => new Set(written.keys()),
    applyDifference: async (_accountId, { add, removeKeys }) => {
      for (const row of add) {
        written.set(row.externalId, row.amountMinorUnits);
      }

      for (const key of removeKeys) {
        written.delete(key);
      }
    },
  };
};

const totalOf = (values: Iterable<number>): number =>
  [...values].reduce((total, value) => total + value, 0);

type Outcome = { world: World; written: Written; sum: number; truth: number };

/** Runs a world to its last arrival, and reads its line and the truth it should equal. */
const settle = async (seed: number, world: World): Promise<Outcome> => {
  const stored = new Map<string, FundingMatchRow>();
  const written: Written = new Map();
  const deps = depsOf(stored, written);
  const arrivals = shuffled(seededRandom(seed * SEED_SPREAD + 1), [
    ...world.sources,
    ...world.ledgers,
  ]);

  for (const record of arrivals) {
    stored.set(record.recordKey, record);
    await reconcileBybitFundingLedger({ targetAccountId: ACCOUNT }, deps);
    await reconcileBybitFundingLedger({ targetAccountId: ACCOUNT }, deps);
  }

  return {
    world,
    written,
    sum: totalOf(world.sources.map(signedOf)) + totalOf(written.values()) / UNITS_PER_WHOLE,
    // A move counts once: a source with its own ledger row counts as the wallet moved it.
    truth:
      totalOf(
        world.sources.filter((source) => world.aloneKeys.has(source.recordKey)).map(signedOf),
      ) + totalOf(world.ledgers.map(signedOf)),
  };
};

const CLEAN: Settings = { loneAmounts: AMOUNTS_APART, withFees: false, withSourcesAlone: false };

const ANY: Settings = { loneAmounts: SOURCE_AMOUNTS, withFees: true, withSourcesAlone: true };

const NO_FEE: Settings = { ...ANY, withFees: false };

const isLone = (world: World, ledger: FundingMatchRow): boolean =>
  !world.ownKeys.has(ledger.recordKey);

describe('the reconcile of the Funding ledger over random worlds', () => {
  it('draws a different world from every seed, with every kind of move among them', () => {
    const worlds = FULL_SEEDS.map((seed) => worldOf(seed, ANY));

    expect(new Set(SEEDS.map((seed) => JSON.stringify(worldOf(seed, ANY)))).size).toBe(
      SEEDS.length,
    );
    expect(worlds.some((world) => world.fees > 0)).toBe(true);
    expect(worlds.some((world) => world.ledgers.some((ledger) => isLone(world, ledger)))).toBe(
      true,
    );
    expect(worlds.some((world) => world.aloneKeys.size > 0)).toBe(true);
  });

  it('over any arrival order, the past line of a clean world equals the truth after the last run, with no double count and no lost row', async () => {
    for (const seed of SEEDS) {
      const { sum, truth } = await settle(seed, worldOf(seed, CLEAN));

      expect({ seed, sum }).toEqual({ seed, sum: truth });
    }
  });

  it('no world lists more rows than it has rows with no source', async () => {
    for (const seed of SEEDS) {
      const { world, written } = await settle(seed, worldOf(seed, ANY));
      const loneCount = world.ledgers.filter((ledger) => isLone(world, ledger)).length;

      expect({ seed, isWithinLone: written.size <= loneCount }).toEqual({
        seed,
        isWithinLone: true,
      });
    }
  });

  // A lost row leaves the sum short of the truth by its own sign: a double count is the move of the
  // direction itself, so a world of one direction has one sign for it.
  it.each([
    ['I', 1],
    ['O', -1],
  ] as const)(
    'no world of direction %s has a line that passes the truth, in its own direction, by more than its fees',
    async (direction, sign) => {
      for (const seed of SEEDS) {
        const { world, sum, truth } = await settle(seed, worldOf(seed, { ...ANY, direction }));

        expect({ seed, isWithinFees: sign * (sum - truth) <= world.fees }).toEqual({
          seed,
          isWithinFees: true,
        });
      }
    },
  );

  it('with no fee, the error of the line is its rows with no source that did not list, less any own row that listed in their place', async () => {
    for (const seed of SEEDS) {
      const { world, written, sum, truth } = await settle(seed, worldOf(seed, NO_FEE));
      const notListed = totalOf(
        world.ledgers
          .filter((ledger) => isLone(world, ledger) && !written.has(ledger.recordKey))
          .map(signedOf),
      );
      const listedInPlace = totalOf(
        world.ledgers
          .filter((ledger) => !isLone(world, ledger) && written.has(ledger.recordKey))
          .map(signedOf),
      );

      expect({ seed, error: truth - sum }).toEqual({ seed, error: notListed - listedInPlace });
    }
  });
});
