import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import {
  type BinanceFiatOrderHistoryDeps,
  type BinanceFiatPaymentHistoryDeps,
  FIAT_WINDOW_MS,
  syncBinanceFiatOrderHistory,
  syncBinanceFiatPaymentHistory,
} from './binance.fiat-history';
import {
  type BinanceFiatOrder,
  type BinanceFiatPayment,
  BinanceHistoryParseError,
  type FiatTransactionType,
} from './binance.history-client';
import { NOW } from './binance.pay-test-fixtures';
import { HISTORY_FLOOR_MS } from './binance.transactions';
import { createBinanceHistoryRun } from './binance.history-budget';
import { fiatOrderOf, fiatPageOf, fiatPaymentOf, fiatServerOf } from './binance.fiat-test-fixtures';

type AnyDeps = Partial<BinanceFiatOrderHistoryDeps & BinanceFiatPaymentHistoryDeps>;

type AnyRecord = BinanceFiatOrder | BinanceFiatPayment;

type Span = { start: number; end: number };

type FiatKind = {
  name: string;
  walkId: 'fiatOrders' | 'fiatPayments';
  readKey: 'fetchFiatOrders' | 'fetchFiatPayments';
  pageRows: number;
  recordOf: (over: { orderNo: string; createTime: number }) => AnyRecord;
  /** A withdrawal or a card sale, the record of the type `'1'` read. */
  sellOf: (over: { orderNo: string; createTime: number }) => AnyRecord;
  sync: (
    request: Parameters<typeof syncBinanceFiatOrderHistory>[0],
    overrides: AnyDeps,
  ) => Promise<unknown>;
};

const ORDERS: FiatKind = {
  name: 'fiat orders',
  walkId: 'fiatOrders',
  readKey: 'fetchFiatOrders',
  pageRows: 500,
  recordOf: fiatOrderOf,
  sellOf: fiatOrderOf,
  sync: syncBinanceFiatOrderHistory,
};

const PAYMENTS: FiatKind = {
  name: 'fiat payments',
  walkId: 'fiatPayments',
  readKey: 'fetchFiatPayments',
  pageRows: 100,
  recordOf: fiatPaymentOf,
  sellOf: (over) => fiatPaymentOf({ ...over, sourceAmount: '0.001', obtainAmount: '2600' }),
  sync: syncBinanceFiatPaymentHistory,
};

const HOUR_MS = 3_600_000;

const SPOT_HOLDINGS = [
  { id: 'h-eur-spot', metadata: { binanceAsset: 'EUR' } },
  { id: 'h-uah-spot', metadata: { binanceAsset: 'UAH' } },
] as unknown as HoldingRow[];

let accountSequence = 0;

type RunInput = {
  now: number;
  records: { orderNo: string; createTime: number }[];
  /** The records of the type `'1'`, which the world reads beside `records`. */
  sells?: { orderNo: string; createTime: number }[];
  unreadable: (span: Span) => boolean;
  /** Spans whose page comes back empty with a total of 5: a page that drifts. */
  drifting?: (span: Span) => boolean;
};

/**
 * What one run did: what it rejected with, the spans it read, and the times and the order numbers
 * of the rows it committed.
 */
type RunOutcome = { error: unknown; spans: Span[]; times: number[]; orderNos: string[] };

const overlapping =
  (range: Span) =>
  (span: Span): boolean =>
    span.start <= range.end && span.end >= range.start;

const worldOf = (kind: FiatKind) => {
  accountSequence += 1;
  const accountId = `acc-owed-ground-${accountSequence}`;
  const fake = walkStateFake({ accountId, alongside: SPOT_HOLDINGS });

  const runOnce = async (input: RunInput): Promise<RunOutcome> => {
    const server = fiatServerOf(
      { '0': input.records.map(kind.recordOf), '1': (input.sells ?? []).map(kind.sellOf) },
      kind.pageRows,
    );
    const spans: Span[] = [];
    const times: number[] = [];
    const orderNos: string[] = [];
    const deps: AnyDeps = {
      now: () => input.now,
      fetchImpl: (async () => ({})) as unknown as typeof fetch,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      ensureHoldings: async () => undefined,
      addTransactions: async (rows: { time: number; externalId: string }[]) => {
        times.push(...rows.map(({ time }) => time));
        orderNos.push(...rows.map(({ externalId }) => externalId.split(':')[2]));

        return rows.length;
      },
      [kind.readKey]: async (
        apiKey: string,
        secret: string,
        type: FiatTransactionType,
        span: Span,
        page: number,
      ) => {
        spans.push({ start: span.start, end: span.end });

        if (input.unreadable(span)) {
          throw new BinanceHistoryParseError();
        }

        if (input.drifting?.(span) === true) {
          return fiatPageOf([], { total: 5 });
        }

        return server(apiKey, secret, type, span, page);
      },
      ...fake.freshDeps(),
      listHoldings: fake.listHoldings,
    };
    const run = createBinanceHistoryRun({ now: () => input.now, sleep: async () => undefined });
    const error = await kind.sync({ targetAccountId: accountId, run }, deps).then(
      () => undefined,
      (failure: unknown) => failure,
    );

    return { error, spans, times, orderNos };
  };

  const marks = () => fake.marksOf(kind.walkId);

  return {
    seed: (over: Parameters<typeof fake.seed>[1]) => fake.seed(kind.walkId, over),
    runOnce,
    marks,
  };
};

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([ORDERS, PAYMENTS])('$name: an owed range whose page cannot be read', (kind) => {
  const OWED_DAY = {
    start: HISTORY_FLOOR_MS + 100 * DAY_MS,
    end: HISTORY_FLOOR_MS + 101 * DAY_MS,
  };
  const LATE = { orderNo: 'late-45', createTime: NOW - 45 * DAY_MS };

  /** Runs a world with the owed day seeded and the clock standing still. */
  const runsOf = async (count: number): Promise<RunOutcome[]> => {
    const world = worldOf(kind);
    const runs: RunOutcome[] = [];
    world.seed({ cursor: NOW - HOUR_MS, pending: [OWED_DAY] });

    for (let index = 0; index < count; index += 1) {
      runs.push(
        await world.runOnce({ now: NOW, records: [LATE], unreadable: overlapping(OWED_DAY) }),
      );
    }

    return runs;
  };

  it('does not keep a late record of the 2-year window from being imported', async () => {
    const runs = await runsOf(3);

    expect(runs.findIndex(({ times }) => times.includes(LATE.createTime))).toBe(
      kind === PAYMENTS ? 0 : 2,
    );
  });

  it('rejects with the unreadable-page error in every run that reads the owed day', async () => {
    const runs = await runsOf(3);
    const reading = runs.filter(({ spans }) => spans.some(overlapping(OWED_DAY)));

    expect(reading.length).toBeGreaterThan(0);
    expect(reading.map(({ error }) => error)).toEqual(
      reading.map(() => expect.any(BinanceHistoryParseError)),
    );
    expect(runs.filter(({ error }) => error === undefined)).toEqual(
      runs.filter(({ spans }) => !spans.some(overlapping(OWED_DAY))),
    );
  });

  it('reads the owed range behind it and imports its record', async () => {
    const second = {
      start: HISTORY_FLOOR_MS + 200 * DAY_MS,
      end: HISTORY_FLOOR_MS + 201 * DAY_MS,
    };
    const inSecond = { orderNo: 'in-second', createTime: second.start + HOUR_MS };
    const world = worldOf(kind);
    world.seed({ cursor: NOW - HOUR_MS, pending: [OWED_DAY, second] });

    const first = await world.runOnce({
      now: NOW,
      records: [inSecond],
      unreadable: overlapping(OWED_DAY),
    });

    expect(first.error).toBeInstanceOf(BinanceHistoryParseError);
    expect(first.times).toContain(inSecond.createTime);
    expect(world.marks().pending).toEqual([OWED_DAY]);
  });
});

describe('a fiat walk that read around a stuck range', () => {
  const CURSOR = NOW - HOUR_MS;
  const STUCK = { start: CURSOR - DAY_MS, end: CURSOR };
  const AT_END = { orderNo: 'r-at-edge', createTime: STUCK.end };

  it('clears the pending range and the stuck mark of fiat payments in 3 runs', async () => {
    const world = worldOf(PAYMENTS);
    const middle = STUCK.start + 10 * HOUR_MS;
    world.seed({ cursor: CURSOR, pending: [STUCK] });
    const imported: number[] = [];

    for (let index = 0; index < 3; index += 1) {
      const run = await world.runOnce({
        now: NOW + index * HOUR_MS,
        records: [AT_END],
        unreadable: (span) => index === 0 && span.start <= middle && middle <= span.end,
      });

      imported.push(...run.times);
    }

    expect(world.marks().pending ?? []).toEqual([]);
    expect(world.marks().rescanStuck ?? []).toEqual([]);
    expect(imported).toContain(AT_END.createTime);
  });

  /**
   * The orders lane has three calls a run and a read costs two, so a run reads one span: the
   * re-scan gets to the stuck range once in a few runs, and the range clears on the 32nd run
   * (measured; the stuck mark is read around, read on its own and then read over).
   */
  const ORDERS_CLEARING_RUNS = 32;

  it('clears the pending range and the stuck mark of fiat orders', async () => {
    const world = worldOf(ORDERS);
    world.seed({ cursor: CURSOR + HOUR_MS, pending: [STUCK], rescanStuck: [STUCK] });
    const imported: number[] = [];

    for (let index = 0; index < ORDERS_CLEARING_RUNS; index += 1) {
      const run = await world.runOnce({
        now: NOW + HOUR_MS + index * HOUR_MS,
        records: [AT_END],
        unreadable: (span) => index === 0 && span.start === STUCK.start && span.end === STUCK.end,
      });

      imported.push(...run.times);
    }

    expect(world.marks().rescanStuck ?? []).toEqual([]);
    expect(
      ((world.marks().pending ?? []) as Span[]).filter(({ start }) => start < STUCK.end),
    ).toEqual([]);
    expect(imported).toContain(AT_END.createTime);
  });
});

describe.each([0, 1, HOUR_MS])(
  'fiat payments: a re-scan window with one failing day, runs %i ms apart',
  (gapMs) => {
    const WINDOW_START = NOW - FIAT_WINDOW_MS;
    /** Half a day and a bit after the window start, so a piece lies before it and one after it. */
    const FAILING_DAY = {
      start: WINDOW_START + Math.round(0.505 * DAY_MS),
      end: WINDOW_START + Math.round(1.505 * DAY_MS),
    };
    const RUNS = 8;
    /** Reads of the forward ground start this far behind the cursor at most. */
    const FORWARD_FROM = NOW - 10 * DAY_MS;

    const runsOfWindow = async () => {
      const world = worldOf(PAYMENTS);
      const rescanReadsOfRun: number[] = [];
      const passEndsAtRuns: number[] = [];
      world.seed({ cursor: NOW - HOUR_MS, pending: [FAILING_DAY] });

      for (let index = 0; index < RUNS; index += 1) {
        const run = await world.runOnce({
          now: NOW + index * gapMs,
          records: [],
          unreadable: () => false,
          drifting: overlapping(FAILING_DAY),
        });
        const rescanReads = new Set(
          run.spans
            .filter(({ start }) => start < FORWARD_FROM)
            .filter(({ start, end }) => start !== FAILING_DAY.start || end !== FAILING_DAY.end)
            .map(({ start, end }) => `${start}-${end}`),
        );

        rescanReadsOfRun.push(rescanReads.size);

        if ((world.marks().rescan as number | undefined) === HISTORY_FLOOR_MS) {
          passEndsAtRuns.push(index);
        }
      }

      return { rescanReadsOfRun, passEndsAtRuns };
    };

    const sumOf = (counts: number[]): number => counts.reduce((sum, count) => sum + count, 0);

    /**
     * A first pass takes `2z + 1 = 3` reads for the one failing day (`z = 1`): the read that fails
     * and marks it, the piece before it and the piece after it, which runs to the window end. A
     * pass after it takes the `z + 1 = 2` pieces. The piece after the day is one read, not a run
     * of reads that double from the day on.
     */
    it('reads the first pass in 3 reads and the next one in 2', async () => {
      const { rescanReadsOfRun, passEndsAtRuns } = await runsOfWindow();
      const [firstEnd, secondEnd] = passEndsAtRuns;

      expect(firstEnd).toBeLessThan(3);
      expect(sumOf(rescanReadsOfRun.slice(0, firstEnd + 1))).toBe(3);
      expect(sumOf(rescanReadsOfRun.slice(firstEnd + 1, secondEnd + 1))).toBe(2);
    });
  },
);

describe.each([ORDERS, PAYMENTS])('$name: a re-scan that goes on over several runs', (kind) => {
  const OWED_DAYS_FROM_NOW = [-663.9, -582.1, -2975.3];
  const OWED = OWED_DAYS_FROM_NOW.map((days) => {
    const start = Math.round(NOW + days * DAY_MS);

    return { start, end: start + DAY_MS };
  });
  const LATE = { orderNo: 'late-39', createTime: NOW - 39 * DAY_MS };
  const SERVED_FROM_RUN = 9;
  const RUNS = 60;

  const runsAMillisecondApart = async () => {
    const world = worldOf(kind);
    const rescanAfterRun: (number | undefined)[] = [];
    const importedAtRuns: number[] = [];
    world.seed({ cursor: NOW - HOUR_MS, pending: OWED });

    for (let index = 0; index < RUNS; index += 1) {
      const run = await world.runOnce({
        now: NOW + index,
        records: index < SERVED_FROM_RUN ? [] : [LATE],
        unreadable: () => false,
        drifting: (span) => OWED.some(overlapping(span)),
      });

      rescanAfterRun.push(world.marks().rescan as number | undefined);

      if (run.times.includes(LATE.createTime)) {
        importedAtRuns.push(index);
      }
    }

    return { rescanAfterRun, importedAtRuns };
  };

  /** The 2 owed days the re-scan window holds (`z = 2`) and the reads of a first pass over it. */
  const FAILING_DAYS_IN_WINDOW = 2;
  const FIRST_PASS_READS = 2 * FAILING_DAYS_IN_WINDOW + 1;

  /**
   * Runs the record may take from the run that first serves it: `importRuns(z) = r * F(z)`, `F(z) =
   * 2z + 1 = 5` the reads of a first pass over the window and `r` the runs between two reads of
   * the re-scan (one for the payments lane, which keeps a read of every run, and four for the
   * orders lane, which alternates the owed windows and the re-scan between its forward runs). The
   * rest of the pass the record is served in and its place in the next one are no more than F(z).
   */
  const IMPORT_WITHIN_RUNS = (kind === PAYMENTS ? 1 : 4) * FIRST_PASS_READS;

  it('imports a record served part way through it within the bound', async () => {
    const { importedAtRuns } = await runsAMillisecondApart();

    expect(importedAtRuns.length).toBeGreaterThan(0);
    expect(importedAtRuns[0] - SERVED_FROM_RUN + 1).toBeLessThanOrEqual(IMPORT_WITHIN_RUNS);
  });

  /**
   * The run that reads the pass's last read (the 5th), after which the mark is the floor again. The
   * payments lane spends 2 of the reads of a run on the re-scan (measured: the rest go to the
   * forward ground and the 2 owed days), so the 5 reads of the pass take 3 runs, the last of them
   * the run of index 2; the orders lane reads one in four runs (measured: 18).
   */
  const PAYMENTS_RESCAN_READS_PER_RUN = 2;
  const PASS_ENDS_AT_RUN =
    kind === PAYMENTS ? Math.ceil(FIRST_PASS_READS / PAYMENTS_RESCAN_READS_PER_RUN) - 1 : 18;

  it('starts the pass again at the history floor once it has read to its end', async () => {
    const { rescanAfterRun } = await runsAMillisecondApart();

    expect(rescanAfterRun.indexOf(HISTORY_FLOOR_MS)).toBe(PASS_ENDS_AT_RUN);
  });
});

describe.each([ORDERS, PAYMENTS])('$name: a full page of rows right after a stuck day', (kind) => {
  const WINDOW_START = NOW - FIAT_WINDOW_MS;
  const FIRST_DAY = { start: WINDOW_START + 200 * DAY_MS, end: WINDOW_START + 201 * DAY_MS };
  const SECOND_DAY = { start: FIRST_DAY.end + 3 * DAY_MS, end: FIRST_DAY.end + 4 * DAY_MS };
  /** A read of the hour after the first day comes back full, whatever type it asks for. */
  const FULL_PAGES = Array.from({ length: 2 * (kind.pageRows + 1) }, (_unused, index) => ({
    orderNo: `full-${index}`,
    createTime:
      FIRST_DAY.end + 1 + Math.floor(((index + 1) * (HOUR_MS - 2)) / (2 * kind.pageRows + 3)),
    type: index % 2 === 0 ? ('0' as const) : ('1' as const),
  }));
  const BETWEEN = { orderNo: 'between', createTime: FIRST_DAY.end + 2 * DAY_MS };
  const AFTER = { orderNo: 'after', createTime: SECOND_DAY.end + 100 * DAY_MS };
  const WANTED = [...FULL_PAGES.map(({ orderNo }) => orderNo), BETWEEN.orderNo, AFTER.orderNo];

  /**
   * The runs the pass over the window takes behind the full pages: the halving to a page that fits
   * and the doubling back. The payments lane reads the re-scan in every run and the orders lane in
   * one of four (measured: the last record is imported in the 7th run on the payments lane and the
   * 30th on the orders lane; the runs below leave slack over them).
   */
  const RUNS = kind === PAYMENTS ? 30 : 100;

  /** The records of the world the walk leaves in `RUNS` runs, from a re-scan mark or its start. */
  const missingFrom = async (rescan: number | undefined): Promise<string[]> => {
    const world = worldOf(kind);
    const importedOrderNos = new Set<string>();
    world.seed({ cursor: NOW - HOUR_MS, pending: [FIRST_DAY, SECOND_DAY], rescan });

    for (let index = 0; index < RUNS; index += 1) {
      const run = await world.runOnce({
        now: NOW,
        records: [...FULL_PAGES.filter(({ type }) => type === '0'), BETWEEN],
        sells: [...FULL_PAGES.filter(({ type }) => type === '1'), AFTER],
        unreadable: () => false,
        drifting: (span) => overlapping(FIRST_DAY)(span) || overlapping(SECOND_DAY)(span),
      });

      for (const orderNo of run.orderNos) {
        importedOrderNos.add(orderNo);
      }
    }

    return WANTED.filter((orderNo) => !importedOrderNos.has(orderNo));
  };

  const noneMissing = { count: 0, first: [] };
  const summaryOf = (missing: string[]) => ({ count: missing.length, first: missing.slice(0, 3) });

  it('imports every record of the world', async () => {
    expect(summaryOf(await missingFrom(undefined))).toEqual(noneMissing);
  });

  /**
   * A pass that starts next to the first day (it ends a millisecond short of it, starts at it, or
   * ends at it) reads the day on its own, so its window starts after the day, as one that comes
   * to the day by its own reads does.
   */
  it.each([
    { name: 'two milliseconds short of the first day', mark: FIRST_DAY.start - 2 },
    { name: 'a millisecond short of the first day', mark: FIRST_DAY.start - 1 },
    { name: 'at the start of the first day', mark: FIRST_DAY.start },
    { name: 'at the end of the first day', mark: FIRST_DAY.end },
  ])('imports every record of the world from a re-scan mark $name', async ({ mark }) => {
    expect(summaryOf(await missingFrom(mark))).toEqual(noneMissing);
  });
});
