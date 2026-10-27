// The four walks owe the coins they did not read before their first multi-coin run (the backfill,
// from their floor to the start they recorded) and read it with BTC left out: the BTC rows of that
// ground were written by the walks that read only BTC.
import { DAY_MS } from '@kiko/dates';
import {
  BACKFILL_AT,
  BACKFILL_WALKS,
  backfillWorldOf,
  coinOfRow,
  KIND_OF,
  mixedPaySendOf,
  NOW,
  recordOf,
  ROWS_PER_RECORD,
  SINCE,
} from '@kiko/test-support/binance-backfill-world';

import { HISTORY_FLOOR_MS } from './binance.transactions';
import { BinanceHistoryParseError } from './binance.history-client';

const MARKS = { cursor: SINCE, multiCoinSince: SINCE, multiCoinSeen: true };

const USDT_AT = BACKFILL_AT + DAY_MS;

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('the backfill of the other coins', () => {
  it.each(BACKFILL_WALKS)(
    'owes no backfill range on the %s walk when it never recorded a start',
    async (name) => {
      const world = backfillWorldOf({
        records: [recordOf(KIND_OF[name], { id: 'usdt-1', coin: 'USDT', time: USDT_AT, units: 5 })],
      });

      await world.walk(name);

      expect(world.owed(name)).toEqual([]);
      expect(world.state.marksOf(name)).not.toHaveProperty('multiCoinSince');
    },
  );

  it.each(BACKFILL_WALKS)('writes no row for a BTC record the %s backfill reads', async (name) => {
    const world = backfillWorldOf({
      marks: { [name]: MARKS },
      records: [
        recordOf(KIND_OF[name], { id: 'btc-1', coin: 'BTC', time: BACKFILL_AT, units: 1_000 }),
        recordOf(KIND_OF[name], { id: 'usdt-1', coin: 'USDT', time: USDT_AT, units: 5 }),
      ],
    });

    await world.walkUntilRead(name);

    expect(world.owed(name)).toEqual([]);
    expect(new Set(world.written.map(coinOfRow))).toEqual(new Set(['USDT']));
  });

  it('writes the USDT rows of a Pay send the backfill reads and skips its BTC rows', async () => {
    const world = backfillWorldOf({
      marks: { pay: MARKS },
      records: [mixedPaySendOf({ id: 'mixed-1', time: BACKFILL_AT })],
    });

    await world.walkUntilRead('pay');

    expect(world.owed('pay')).toEqual([]);
    expect(world.written.map(coinOfRow)).toEqual(['USDT']);
  });

  it.each(BACKFILL_WALKS)(
    'writes one row for a USDT record the forward pass and the %s backfill both read',
    async (name) => {
      const world = backfillWorldOf({
        marks: { [name]: { ...MARKS, cursor: BACKFILL_AT - DAY_MS } },
        records: [
          recordOf(KIND_OF[name], { id: 'usdt-1', coin: 'USDT', time: BACKFILL_AT, units: 5 }),
        ],
      });

      await world.walkUntilRead(name);

      expect(world.stored.size).toBe(ROWS_PER_RECORD[name]);
      expect(world.written.length).toBeGreaterThan(world.stored.size);
      expect(
        world.written.every((row) => world.stored.get(row.externalId)?.holdingId === row.holdingId),
      ).toBe(true);
    },
  );

  it.each(BACKFILL_WALKS)(
    'reads the backfill of the %s walk once when the seen mark was lost beside a stored start',
    async (name) => {
      const world = backfillWorldOf({
        marks: { [name]: { cursor: SINCE, multiCoinSince: SINCE } },
        records: [
          recordOf(KIND_OF[name], { id: 'usdt-1', coin: 'USDT', time: BACKFILL_AT, units: 5 }),
        ],
      });

      await world.walk(name);

      expect(world.state.marksOf(name).multiCoinSince).toBeLessThan(SINCE);

      await world.walkUntilRead(name);
      await world.walk(name);
      await world.walk(name);

      expect(world.written).toHaveLength(ROWS_PER_RECORD[name]);
    },
  );

  it.each(BACKFILL_WALKS)(
    'keeps a point owed again inside a backfill window of the %s walk owed to the backfill',
    async (name) => {
      const world = backfillWorldOf({
        marks: { [name]: MARKS },
        records: [
          recordOf(KIND_OF[name], {
            id: 'junk-1',
            coin: 'USDT',
            time: BACKFILL_AT,
            units: 1,
            amount: 'junk',
          }),
        ],
      });

      await world.walkUntilRead(name);

      const points = (
        (world.state.marksOf(name).pending ?? []) as { kind?: string; scope?: string }[]
      ).filter(({ kind }) => kind === 'point');

      expect(points).not.toHaveLength(0);
      expect(points.map(({ scope }) => scope)).toEqual(points.map(() => 'backfill'));
    },
  );
});

// The twin of the capital walk's dense-day pin in `binance.transactions.test.ts`, in the world of a
// 1.2 upgrade: a cursor and no seen mark, so the walk also owes the backfill of the other coins.
// That pin keeps its bound of 6 runs for the records in a world that owes no backfill. The
// backfill adds runs but holds no record back: the records arrive in the first run after the one
// that reaches now, and the backfill, which skips the BTC rows, is read in the seventh.
describe('a dense day behind the cursor of a capital walk upgraded from 1.2', () => {
  const REACHED_AT = Date.UTC(2024, 0, 4);
  const CURSOR = REACHED_AT - 120 * DAY_MS;
  const RECORDS_WITHIN_RUNS = 6;
  const BACKFILL_WITHIN_RUNS = 7;

  const denseDay = Array.from({ length: 4_000 }, (_unused, index) =>
    recordOf('withdraw', {
      id: `dense-${index}`,
      coin: 'BTC',
      time: CURSOR - DAY_MS + index * 20_000,
      units: 1,
    }),
  );
  const newer = [1, 2, 3].map((hours) =>
    recordOf('withdraw', {
      id: `newer-${hours}`,
      coin: 'BTC',
      time: CURSOR + hours * 3_600_000,
      units: 1,
    }),
  );
  const records = [...denseDay, ...newer];

  const runsOfUpgrade = async () => {
    const world = backfillWorldOf({ marks: { capital: { cursor: CURSOR } }, records });

    await world.walk('capital', REACHED_AT);

    const firstRun = {
      cursor: world.state.marksOf('capital').cursor,
      newerImported: newer.every(({ body }) => world.stored.has(`acc-1:withdraw:${body.id}`)),
    };
    const stored: number[] = [];
    const complete: boolean[] = [];

    while (complete.at(-1) !== true && complete.length < 30) {
      complete.push((await world.walk('capital', REACHED_AT)).complete);
      stored.push(world.stored.size);
    }

    return { world, firstRun, stored, complete };
  };

  it('reaches now in the first run, and imports every record within 6 runs after it', async () => {
    const { firstRun, stored } = await runsOfUpgrade();

    expect(firstRun).toEqual({ cursor: REACHED_AT, newerImported: true });
    expect(stored.slice(0, RECORDS_WITHIN_RUNS).at(-1)).toBe(records.length);
  });

  it('reads the backfill and completes within 7 runs after the first', async () => {
    const { world, complete } = await runsOfUpgrade();

    expect(complete.at(-1)).toBe(true);
    expect(complete.length).toBeLessThanOrEqual(BACKFILL_WITHIN_RUNS);
    expect(world.owed('capital')).toEqual([]);
    expect(world.stored.size).toBe(records.length);
  });
});

// The capital walk reads at most 9 withdrawal pages a run. The owed ground for every coin is read
// before the backfill, so ground that is refused every run (a page Binance serves off its
// contract, which the walk reads on past) could spend the whole budget of every run and the
// backfill would never be read: the backfill keeps one window a run while it is owed.
describe('the backfill of a capital walk whose owed ground for every coin is refused every run', () => {
  const START = NOW - 1_200 * DAY_MS;
  const REFUSED_WINDOWS = 10;
  const WINDOW_MS = 89 * DAY_MS;
  const USDT_WINDOW = 3;
  const REFUSED_BEFORE = NOW - 300 * DAY_MS;

  const refused = Array.from({ length: REFUSED_WINDOWS }, (_unused, index) => ({
    start: REFUSED_BEFORE - index * 80 * DAY_MS,
    end: REFUSED_BEFORE - index * 80 * DAY_MS + 10 * DAY_MS,
  }));
  const usdt = recordOf('withdraw', {
    id: 'usdt-1',
    coin: 'USDT',
    time: HISTORY_FLOOR_MS + (USDT_WINDOW - 1) * WINDOW_MS + DAY_MS,
    units: 5,
  });
  // The newest owed window of the walk, the last one a run reads: the only one that can be read.
  const readable = { start: NOW - 250 * DAY_MS, end: NOW - 240 * DAY_MS };
  const late = recordOf('withdraw', {
    id: 'btc-1',
    coin: 'BTC',
    time: readable.start + DAY_MS,
    units: 5,
  });

  const runsOfRefusedWorld = async (runs: number) => {
    const world = backfillWorldOf({
      marks: {
        capital: {
          cursor: NOW - DAY_MS,
          multiCoinSince: START,
          multiCoinSeen: true,
          pending: [...refused, readable],
        },
      },
      records: [usdt, late],
      refusing: ({ start }) => start >= START && start <= REFUSED_BEFORE,
    });
    const owedFrom: (number | undefined)[] = [];
    const arrived: boolean[] = [];
    const lateArrived: boolean[] = [];

    for (let run = 1; run <= runs; run += 1) {
      await expect(world.walk('capital')).rejects.toBeInstanceOf(BinanceHistoryParseError);
      owedFrom.push(world.owed('capital').at(0)?.start);
      arrived.push(world.stored.has('acc-1:withdraw:usdt-1'));
      lateArrived.push(world.stored.has('acc-1:withdraw:btc-1'));
    }

    return { owedFrom, arrived, lateArrived };
  };

  it('reads one window of the backfill in each run, so its ground shrinks every run', async () => {
    const { owedFrom } = await runsOfRefusedWorld(USDT_WINDOW);

    expect(owedFrom).toEqual([
      HISTORY_FLOOR_MS + WINDOW_MS,
      HISTORY_FLOOR_MS + 2 * WINDOW_MS,
      HISTORY_FLOOR_MS + 3 * WINDOW_MS,
    ]);
  });

  it('imports a USDT record of the backfill within as many runs as its window is deep', async () => {
    const { arrived } = await runsOfRefusedWorld(USDT_WINDOW);

    expect(arrived).toEqual([false, false, true]);
  });

  it('still reaches the one owed window that can be read, behind the refused ones', async () => {
    const { lateArrived } = await runsOfRefusedWorld(2);

    expect(lateArrived).toEqual([false, true]);
  });
});

// The backfill is a round-robin of its own: a window of it that is refused every run goes behind
// the others once it has been tried, where read first in every run it would hold back every
// window of the backfill behind it while the owed ground for every coin spends the rest.
describe('the backfill of a capital walk whose first window is refused every run', () => {
  const START = NOW - 1_200 * DAY_MS;
  const WINDOW_MS = 89 * DAY_MS;
  const USDT_WINDOW = 3;
  const REFUSED_BEFORE = NOW - 300 * DAY_MS;

  const refusedAllCoin = Array.from({ length: 10 }, (_unused, index) => ({
    start: REFUSED_BEFORE - index * 80 * DAY_MS,
    end: REFUSED_BEFORE - index * 80 * DAY_MS + 10 * DAY_MS,
  }));
  const usdt = recordOf('withdraw', {
    id: 'usdt-1',
    coin: 'USDT',
    time: HISTORY_FLOOR_MS + (USDT_WINDOW - 1) * WINDOW_MS + DAY_MS,
    units: 5,
  });

  const runsOfRefusedFirstWindow = async (runs: number) => {
    const world = backfillWorldOf({
      marks: {
        capital: {
          cursor: NOW - DAY_MS,
          multiCoinSince: START,
          multiCoinSeen: true,
          pending: refusedAllCoin,
        },
      },
      records: [usdt],
      refusing: ({ start }) =>
        (start >= START && start <= REFUSED_BEFORE) || start === HISTORY_FLOOR_MS,
    });
    const arrived: boolean[] = [];

    for (let run = 1; run <= runs; run += 1) {
      await expect(world.walk('capital')).rejects.toBeInstanceOf(BinanceHistoryParseError);
      arrived.push(world.stored.has('acc-1:withdraw:usdt-1'));
    }

    return { arrived, world };
  };

  it('imports a USDT record behind it within as many runs as its window is deep', async () => {
    const { arrived } = await runsOfRefusedFirstWindow(USDT_WINDOW);

    expect(arrived).toEqual([false, false, true]);
  });
});
