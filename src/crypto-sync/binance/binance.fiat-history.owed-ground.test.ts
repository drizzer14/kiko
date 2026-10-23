import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import {
  type BinanceFiatOrderHistoryDeps,
  type BinanceFiatPaymentHistoryDeps,
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
import { fiatOrderOf, fiatPaymentOf, fiatServerOf } from './binance.fiat-test-fixtures';

type AnyDeps = Partial<BinanceFiatOrderHistoryDeps & BinanceFiatPaymentHistoryDeps>;

type AnyRecord = BinanceFiatOrder | BinanceFiatPayment;

type Span = { start: number; end: number };

type FiatKind = {
  name: string;
  walkId: 'fiatOrders' | 'fiatPayments';
  readKey: 'fetchFiatOrders' | 'fetchFiatPayments';
  pageRows: number;
  recordOf: (over: { orderNo: string; createTime: number }) => AnyRecord;
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
  sync: syncBinanceFiatOrderHistory,
};

const PAYMENTS: FiatKind = {
  name: 'fiat payments',
  walkId: 'fiatPayments',
  readKey: 'fetchFiatPayments',
  pageRows: 100,
  recordOf: fiatPaymentOf,
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
  unreadable: (span: Span) => boolean;
};

/** What one run did: what it rejected with, the spans it read and the times it committed. */
type RunOutcome = { error: unknown; spans: Span[]; times: number[] };

const overlapping =
  (range: Span) =>
  (span: Span): boolean =>
    span.start <= range.end && span.end >= range.start;

const worldOf = (kind: FiatKind) => {
  accountSequence += 1;
  const accountId = `acc-owed-ground-${accountSequence}`;
  const fake = walkStateFake({ accountId, alongside: SPOT_HOLDINGS });

  const runOnce = async (input: RunInput): Promise<RunOutcome> => {
    const server = fiatServerOf({ '0': input.records.map(kind.recordOf), '1': [] }, kind.pageRows);
    const spans: Span[] = [];
    const times: number[] = [];
    const deps: AnyDeps = {
      now: () => input.now,
      fetchImpl: (async () => ({})) as unknown as typeof fetch,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      ensureHoldings: async () => undefined,
      addTransactions: async (rows: { time: number }[]) => {
        times.push(...rows.map(({ time }) => time));

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

    return { error, spans, times };
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
