// The four walks over a seeded account, by the same callers the app runs (the real client over a
// served fetch): the ground a walk read for BTC alone is read for the other coins exactly once, it
// writes no BTC row, and a start that was stored malformed owes one range that never grows.
import { DAY_MS } from '@kiko/dates';
import {
  BACKFILL_WALKS,
  type BackfillWalk,
  backfillWorldOf,
  coinOfRow,
  KIND_OF,
  NOW,
  recordOf,
  type ServedRecord,
  SINCE,
} from '@kiko/test-support/binance-backfill-world';
import type { Currency } from '@kiko/currency/currency';
import { sweep } from '@kiko/test-support/property-sweep';
import { seededRandom } from '@kiko/test-support/seeded-random';

const HOUR_MS = 3_600_000;
const SECOND_MS = 1_000;
const CLOCK_GAPS = [0, HOUR_MS, DAY_MS];
const SEEDS = sweep(Array.from({ length: 40 }, (_unused, position) => 3 + position * 8));
const COINS: Currency[] = ['BTC', 'USDT', 'ETH'];
const RECORDS_PER_WALK = 8;
const ROUNDS = 40;
const RUNS = 10;
const OLDEST_AGO = 150 * DAY_MS;
const NEWEST_AGO = 100 * DAY_MS;

const KEY_MARKER: Record<BackfillWalk, string> = {
  capital: ':deposit:',
  pay: ':pay:',
  transfer: ':xfer:',
  earn: ':earn:',
};

/** The holding key and signed units a row sits on. */
type RowExpectation = [holdingKey: string, signedUnits: number];

const rowsExpectedOf = (walk: BackfillWalk, coin: string, units: number): RowExpectation[] => {
  if (walk === 'transfer') {
    return [
      [coin, -units],
      [`${coin}:funding`, units],
    ];
  }

  if (walk === 'earn') {
    return [[`${coin}:earn`, units]];
  }

  return [[coin, walk === 'pay' ? -units : units]];
};

type World = { records: ServedRecord[]; expected: Record<BackfillWalk, RowExpectation[]> };

/** Records of tracked coins before the start, at times only the backfill reaches. */
const randomWorld = (seed: number): World => {
  const random = seededRandom(seed);
  const world: World = { records: [], expected: { capital: [], pay: [], transfer: [], earn: [] } };
  let nextUnits = 1_000;

  for (const walk of BACKFILL_WALKS) {
    for (let position = 0; position < RECORDS_PER_WALK; position += 1) {
      const coin = COINS[Math.floor(random() * COINS.length)];
      const ago = NEWEST_AGO + Math.floor(random() * (OLDEST_AGO - NEWEST_AGO));

      nextUnits += 1;
      world.records.push(
        recordOf(KIND_OF[walk], {
          id: `${walk}-${position}`,
          coin,
          time: Math.floor((NOW - ago) / SECOND_MS) * SECOND_MS,
          units: nextUnits,
          send: true,
        }),
      );

      if (coin !== 'BTC') {
        world.expected[walk].push(...rowsExpectedOf(walk, coin, nextUnits));
      }
    }
  }

  return world;
};

const MARKS = { cursor: SINCE, multiCoinSince: SINCE, multiCoinSeen: true };

const marksOfAll = (marks: Record<string, unknown>) =>
  Object.fromEntries(BACKFILL_WALKS.map((walk) => [walk, marks]));

const sorted = (rows: RowExpectation[]): string[] =>
  rows.map(([holdingKey, units]) => `${holdingKey}|${units}`).sort();

const groundOf = (ranges: { start: number; end: number }[]): number =>
  ranges.reduce((total, range) => total + (range.end - range.start), 0);

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe.each(CLOCK_GAPS)('the backfill at a clock gap of %d ms', (gap) => {
  it.each(SEEDS)(
    'imports every non-BTC record before the start exactly once and adds no BTC row (seed %d)',
    async (seed) => {
      const { records, expected } = randomWorld(seed);
      const world = backfillWorldOf({ marks: marksOfAll(MARKS), records });

      for (let round = 0; round < ROUNDS; round += 1) {
        for (const walk of BACKFILL_WALKS) {
          await world.walk(walk, NOW + round * gap);
        }

        if (BACKFILL_WALKS.every((walk) => world.owed(walk).length === 0)) {
          break;
        }
      }

      expect(world.written.map(coinOfRow)).not.toContain('BTC');
      expect(world.written).toHaveLength(world.stored.size);

      for (const walk of BACKFILL_WALKS) {
        const stored = [...world.stored.values()]
          .filter((row) => row.externalId.includes(KEY_MARKER[walk]))
          .map((row): RowExpectation => [row.holdingId.slice('h-'.length), row.amountMinorUnits]);

        expect({ walk, rows: sorted(stored) }).toEqual({ walk, rows: sorted(expected[walk]) });
      }
    },
  );
});

describe('a walk with a start that was stored malformed', () => {
  it.each(CLOCK_GAPS)(
    'owes one backfill range that never grows, over ten runs at a %s clock gap, from a malformed start',
    async (gap) => {
      const world = backfillWorldOf({
        marks: marksOfAll({ cursor: SINCE, multiCoinSince: 'junk', multiCoinSeen: true }),
      });

      for (const walk of BACKFILL_WALKS) {
        const grounds: number[] = [];

        for (let run = 0; run < RUNS; run += 1) {
          await world.walk(walk, NOW + run * gap);
          grounds.push(groundOf(world.owed(walk)));
        }

        const starts = world.state
          .writes()
          .filter((write) => write.walkName === walk && write.field === 'multiCoinSince');

        expect({ walk, starts: starts.length }).toEqual({ walk, starts: 1 });
        expect(world.owed(walk).every((range) => range.end <= SINCE)).toBe(true);
        expect({ walk, grounds }).toEqual({
          walk,
          grounds: [...grounds].sort((left, right) => right - left),
        });
      }
    },
  );
});
