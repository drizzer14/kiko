import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';

import {
  type BinancePayHistoryDeps,
  PAY_WINDOW_MS,
  payFloorMs,
  syncBinancePayHistory,
} from './binance.pay-history';
import {
  COSTS,
  createBinanceHistoryRun,
  LANE_CALL_CAPS,
  UID_WEIGHT_BUDGET_1M,
} from './binance.history-budget';
import {
  type BinancePayOrder,
  PAY_PAGE_LIMIT,
  type PayHistoryPage,
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';
import { HISTORY_FLOOR_MS } from './binance.transactions';
import { NOW, OTHER, OWN, party, payOrder } from './binance.pay-test-fixtures';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';

const order = payOrder;
const WARN_TAG_STOP = '[binance sync] history window stopped';
const WARN_TAG_NOTICE = '[binance sync] history row left out';
const FLOOR = Date.UTC(2025, 3, 20);

// `cooldownUntilByAccount` is module-level and has no exported reset, so every case
// uses its own account id.
let accountSequence = 0;
const nextAccountId = (): string => {
  accountSequence += 1;

  return `acc-pay-${accountSequence}`;
};

const payPage = (rows: BinancePayOrder[], over: Partial<PayHistoryPage> = {}): PayHistoryPage => ({
  rows,
  gathered: rows.length,
  hasBtcFundedOtherCoinOrder: false,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  ...over,
});

const fullPage = (over: Partial<PayHistoryPage> = {}): PayHistoryPage =>
  payPage([], { gathered: PAY_PAGE_LIMIT, ...over });

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

/** The Spot holding of a connected account whose capital walk is caught up to `capitalCursor`. */
const spotAt = (capitalCursor: number | null, payCursor: number | null = null): HoldingRow =>
  holdingWith('h-spot', {
    binanceAsset: 'BTC',
    binanceHistoryCursor: capitalCursor ?? undefined,
    binancePayHistoryCursor: payCursor ?? undefined,
  });

const makeDeps = (over: Partial<BinancePayHistoryDeps> = {}): BinancePayHistoryDeps => ({
  now: () => NOW,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  listHoldings: async () => [spotAt(NOW)],
  fetchAccount: jest.fn(async () => ({ balances: [], uid: OWN })),
  fetchPayHistory: jest.fn(async () => payPage([])),
  ensureHoldings: jest.fn(async () => undefined),
  addTransactions: jest.fn(async (rows: unknown[]) => rows.length),
  writeWalkCursor: jest.fn(async () => undefined),
  listHoldingTransactions: jest.fn(async () => []),
  ...over,
});

const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

const sync = (deps: BinancePayHistoryDeps, accountId: string = nextAccountId(), run = freshRun()) =>
  syncBinancePayHistory({ targetAccountId: accountId, run }, deps);

type PayQuery = { startTime: number; endTime: number };

const queriesOf = (deps: BinancePayHistoryDeps): PayQuery[] =>
  (deps.fetchPayHistory as jest.Mock).mock.calls.map((call) => call[2] as PayQuery);

type AddedRow = {
  holdingId: string;
  amountMinorUnits: number;
  externalId: string;
  description: string;
  source: string;
  time: number;
};

const addedRows = (deps: BinancePayHistoryDeps, call = 0) =>
  (deps.addTransactions as jest.Mock).mock.calls[call][0] as AddedRow[];

const cursorWritesOf = (deps: BinancePayHistoryDeps): number[] =>
  (deps.writeWalkCursor as jest.Mock).mock.calls.map((call) => call[2] as number);

/** The pages of a scripted history, in order; an empty page once they run out. */
const scripted = (pages: PayHistoryPage[]) => jest.fn(async () => pages.shift() ?? payPage([]));

type ServerShape = { ascending: boolean; endExclusive: boolean };

/**
 * A Pay history that answers as Binance might: either order, and either end of the range
 * open. It returns at most one page, and its `gathered` is that page's size.
 */
const serverOf = (orders: BinancePayOrder[], shape: ServerShape) =>
  jest.fn(async (_apiKey: string, _secret: string, query: PayQuery) => {
    const direction = shape.ascending ? 1 : -1;
    const inRange = orders
      .filter(
        (candidate) =>
          candidate.transactionTime >= query.startTime &&
          (shape.endExclusive
            ? candidate.transactionTime < query.endTime
            : candidate.transactionTime <= query.endTime),
      )
      .sort((left, right) => direction * (left.transactionTime - right.transactionTime));

    return payPage(inRange.slice(0, PAY_PAGE_LIMIT));
  });

/** `count` BTC orders, one key each, spread evenly from `from` over `span`. */
const spreadOrders = (count: number, from: number, span: number): BinancePayOrder[] =>
  Array.from({ length: count }, (_unused, index) =>
    order({
      transactionId: `spread-${index}`,
      transactionTime: from + Math.floor((index * span) / count),
    }),
  );

const storedKeysOf = (deps: BinancePayHistoryDeps): string[] => [
  ...new Set(
    (deps.addTransactions as jest.Mock).mock.calls.flatMap((call) =>
      (call[0] as AddedRow[]).map((row) => row.externalId),
    ),
  ),
];

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('the walk window range', () => {
  it('walks from the 18-month floor to now in contiguous 89-day windows, oldest first', async () => {
    const deps = makeDeps();

    const result = await sync(deps);

    const queries = queriesOf(deps);
    expect(payFloorMs(NOW)).toBe(FLOOR);
    expect(result).toEqual({ imported: 0, complete: true });
    expect(queries).toHaveLength(7);
    expect(queries[0].startTime).toBe(FLOOR);
    expect(queries.at(-1)?.endTime).toBe(NOW);

    for (const [index, query] of queries.entries()) {
      expect(query.startTime).toBe(index === 0 ? FLOOR : queries[index - 1].endTime);
      expect(query.endTime - query.startTime).toBeLessThanOrEqual(PAY_WINDOW_MS);
    }
  });

  it('keeps ten days of margin inside the 18 months, clamped to the last day of a shorter month', () => {
    expect(payFloorMs(Date.UTC(2026, 7, 31, 13, 5))).toBe(Date.UTC(2025, 2, 10, 13, 5));
    expect(payFloorMs(Date.UTC(2028, 1, 29))).toBe(Date.UTC(2026, 8, 8));
    expect(payFloorMs(NOW)).toBe(Date.UTC(2025, 3, 10) + 10 * DAY_MS);
  });

  it('never goes before the shared history floor', () => {
    expect(payFloorMs(Date.UTC(2018, 0, 1))).toBe(HISTORY_FLOOR_MS);
  });

  it('asks for the floor, not the 2017 cursor a disconnect left, on a reconnect', async () => {
    const deps = makeDeps({ listHoldings: async () => [spotAt(NOW, HISTORY_FLOOR_MS)] });

    await sync(deps);

    expect(queriesOf(deps)[0].startTime).toBe(payFloorMs(NOW));
    expect(Math.min(...queriesOf(deps).map((query) => query.startTime))).toBe(payFloorMs(NOW));
  });

  it('re-scans one window back when the cursor is nearly caught up', async () => {
    const deps = makeDeps({ listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)] });

    await sync(deps);

    expect(queriesOf(deps)).toEqual([{ startTime: NOW - PAY_WINDOW_MS, endTime: NOW }]);
  });

  it('re-scans a day behind a cursor that is older than a window', async () => {
    const cursor = NOW - 120 * DAY_MS;
    const deps = makeDeps({ listHoldings: async () => [spotAt(NOW, cursor)] });

    await sync(deps);

    expect(queriesOf(deps)[0].startTime).toBe(cursor - DAY_MS);
  });

  it('writes the Pay cursor at each window end, on the Spot holding', async () => {
    const deps = makeDeps();

    await sync(deps);

    const written = (deps.writeWalkCursor as jest.Mock).mock.calls;
    expect(written.map((call) => call.slice(0, 2))).toEqual(
      Array.from({ length: 7 }, () => ['h-spot', 'binancePayHistoryCursor']),
    );
    expect(cursorWritesOf(deps)).toEqual(queriesOf(deps).map((query) => query.endTime));
  });
});

describe('the cap at the capital walk watermark', () => {
  it('ends the newest window at the capital cursor, not at now, and commits it', async () => {
    const capitalCursor = NOW - 5_000;
    const deps = makeDeps({
      listHoldings: async () => [spotAt(capitalCursor, capitalCursor - 3_600_000)],
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(queriesOf(deps).at(-1)?.endTime).toBe(capitalCursor);
    expect(deps.writeWalkCursor).toHaveBeenLastCalledWith(
      'h-spot',
      'binancePayHistoryCursor',
      capitalCursor,
    );
  });

  it('starts the next run from the cursor it left, one overlap behind', async () => {
    const capitalCursor = NOW - 5_000;
    const written: number[] = [];
    const first = makeDeps({
      listHoldings: async () => [spotAt(capitalCursor)],
      writeWalkCursor: jest.fn(async (_id: string, _field: string, cursorMs: number) => {
        written.push(cursorMs);
      }),
    });
    await sync(first);

    const later = NOW + 2 * DAY_MS;
    const second = makeDeps({
      now: () => later,
      listHoldings: async () => [spotAt(later - 1_000, written.at(-1))],
    });
    await sync(second);

    expect(written.at(-1)).toBe(capitalCursor);
    expect(queriesOf(second)[0].startTime).toBe(later - 1_000 - PAY_WINDOW_MS);
  });

  it('makes no request while the capital walk has no watermark', async () => {
    const deps = makeDeps({ listHoldings: async () => [spotAt(null)] });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchAccount).not.toHaveBeenCalled();
    expect(deps.fetchPayHistory).not.toHaveBeenCalled();
  });

  it('makes no request while the capital watermark is older than the Pay floor', async () => {
    const deps = makeDeps({ listHoldings: async () => [spotAt(Date.UTC(2025, 0, 1))] });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchAccount).not.toHaveBeenCalled();
    expect(deps.fetchPayHistory).not.toHaveBeenCalled();
  });

  it('does nothing, and is complete, with no Spot holding or no credentials', async () => {
    const noSpot = makeDeps({ listHoldings: async () => [] });
    const noCredentials = makeDeps({ readCredentials: async () => undefined });

    expect(await sync(noSpot)).toEqual({ imported: 0, complete: true });
    expect(await sync(noCredentials)).toEqual({ imported: 0, complete: true });
    expect(noSpot.fetchPayHistory).not.toHaveBeenCalled();
    expect(noCredentials.fetchPayHistory).not.toHaveBeenCalled();
  });
});

describe('importing the orders of a window', () => {
  const recent = { listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)] };

  it('maps an outgoing order onto Spot, signed, with the nickname and the account-keyed id', async () => {
    const accountId = nextAccountId();
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () => payPage([order()])),
    });

    const result = await sync(deps, accountId);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(addedRows(deps)).toEqual([
      {
        holdingId: 'h-spot',
        amountMinorUnits: -100_000,
        time: NOW - 10 * DAY_MS,
        source: 'binance',
        externalId: `${accountId}:pay:C2C:tx-1:2`,
        description: 'Ann',
      },
    ]);
  });

  it('commits the rows before it advances the watermark', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () => {
        calls.push('fetchPayHistory');

        return payPage([order()]);
      }),
      addTransactions: jest.fn(async (rows: unknown[]) => {
        calls.push('addTransactions');

        return rows.length;
      }),
      writeWalkCursor: jest.fn(async () => {
        calls.push('writeWalkCursor');
      }),
    });

    await sync(deps);

    expect(calls).toEqual(['fetchPayHistory', 'addTransactions', 'writeWalkCursor']);
  });

  it('advances the watermark without an import for a window with no BTC order', async () => {
    const deps = makeDeps(recent);

    await sync(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(1);
  });

  it('reads an incoming order with the uid it fetched once for the whole run', async () => {
    const received = order({
      amount: '0.002',
      payerInfo: party('Bob', undefined),
      receiverInfo: party('Me', OWN),
    });
    const deps = makeDeps({ fetchPayHistory: jest.fn(async () => payPage([received])) });

    await sync(deps);

    expect(deps.fetchAccount).toHaveBeenCalledTimes(1);
    expect(addedRows(deps, 0)).toMatchObject([{ amountMinorUnits: 200_000, description: 'Bob' }]);
  });

  it('stores only the counterparty name: no id, no party fields reach a row', async () => {
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () => payPage([order()])),
    });

    await sync(deps);

    const [row] = addedRows(deps);
    expect(Object.keys(row).sort()).toEqual([
      'amountMinorUnits',
      'description',
      'externalId',
      'holdingId',
      'source',
      'time',
    ]);
    expect(JSON.stringify(row)).not.toContain(OWN);
    expect(JSON.stringify(row)).not.toContain(OTHER);
  });
});

describe('an adaptive window', () => {
  // The capital watermark sits one window above the floor, so the walk is exactly one window.
  const WINDOW_START = FLOOR;
  const WINDOW_END = FLOOR + PAY_WINDOW_MS;
  const oneWindow = { listHoldings: async () => [spotAt(WINDOW_END)] };
  const HALF = Math.floor(PAY_WINDOW_MS / 2);

  it('halves a full window, commits the half that fits, then reads on from where it ended', async () => {
    const calls: string[] = [];
    const pages = [
      fullPage(),
      payPage([order({ transactionId: 'a' })]),
      payPage([order({ transactionId: 'b' })]),
    ];
    const deps = makeDeps({
      ...oneWindow,
      fetchPayHistory: jest.fn(async () => {
        calls.push('fetch');

        return pages.shift() ?? payPage([]);
      }),
      addTransactions: jest.fn(async (rows: unknown[]) => {
        calls.push('add');

        return rows.length;
      }),
      writeWalkCursor: jest.fn(async (_id: string, _field: string, cursorMs: number) => {
        calls.push(`cursor ${cursorMs - WINDOW_START}`);
      }),
    });

    const result = await sync(deps);

    expect(queriesOf(deps)).toEqual([
      { startTime: WINDOW_START, endTime: WINDOW_END },
      { startTime: WINDOW_START, endTime: WINDOW_START + HALF },
      { startTime: WINDOW_START + HALF, endTime: WINDOW_END },
    ]);
    expect(calls).toEqual([
      'fetch',
      'fetch',
      'add',
      `cursor ${HALF}`,
      'fetch',
      'add',
      `cursor ${PAY_WINDOW_MS}`,
    ]);
    expect(result).toEqual({ imported: 2, complete: true });
  });

  it('never moves the watermark back while a re-scan commits a sub-window behind it', async () => {
    const cursor = NOW - 3_600_000;
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW, cursor)],
      fetchPayHistory: scripted([fullPage(), payPage([]), payPage([])]),
    });

    await sync(deps);

    expect(cursorWritesOf(deps)).toEqual([cursor, NOW]);
  });

  it('counts a full page of other coins as a full page, so their orders cannot end the window early', async () => {
    const deps = makeDeps({
      ...oneWindow,
      fetchPayHistory: scripted([fullPage(), payPage([order()]), payPage([])]),
    });

    const result = await sync(deps);

    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(3);
    expect(result.imported).toBe(1);
  });

  it('keeps an order that two sub-windows both return under one key', async () => {
    const boundary = order({ transactionId: 'boundary', transactionTime: WINDOW_START + HALF });
    const deps = makeDeps({
      ...oneWindow,
      fetchPayHistory: scripted([fullPage(), payPage([boundary]), payPage([boundary])]),
    });

    await sync(deps);

    expect(storedKeysOf(deps)).toHaveLength(1);
    expect(addedRows(deps, 0)[0].externalId).toBe(addedRows(deps, 1)[0].externalId);
  });

  it('sends no request whose startTime is not before its endTime', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(FLOOR + 8)],
      fetchPayHistory: serverOf(spreadOrders(PAY_PAGE_LIMIT + 50, FLOOR + 5, 0), {
        ascending: true,
        endExclusive: false,
      }),
    });

    await sync(deps);

    expect(queriesOf(deps).length).toBeGreaterThan(1);
    expect(queriesOf(deps).every((query) => query.startTime < query.endTime)).toBe(true);
  });

  it('stops a one-millisecond window that is still full, with the cursor unmoved', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(FLOOR + 2)],
      fetchPayHistory: serverOf(spreadOrders(PAY_PAGE_LIMIT + 50, FLOOR, 0), {
        ascending: true,
        endExclusive: false,
      }),
    });

    const result = await sync(deps);

    expect(queriesOf(deps)).toEqual([
      { startTime: FLOOR, endTime: FLOOR + 2 },
      { startTime: FLOOR, endTime: FLOOR + 1 },
    ]);
    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-page-stuck' }],
    ]);
  });

  it('keeps what committed before the sub-window that cannot be split', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(FLOOR + 8)],
      fetchPayHistory: serverOf(spreadOrders(PAY_PAGE_LIMIT + 50, FLOOR + 5, 0), {
        ascending: false,
        endExclusive: false,
      }),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(cursorWritesOf(deps)).toEqual([FLOOR + 4]);
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-page-stuck' }],
    ]);
  });

  describe.each([
    ['oldest first, end inclusive', { ascending: true, endExclusive: false }],
    ['oldest first, end exclusive', { ascending: true, endExclusive: true }],
    ['newest first, end inclusive', { ascending: false, endExclusive: false }],
    ['newest first, end exclusive', { ascending: false, endExclusive: true }],
  ])('against a history that answers %s', (_label, shape) => {
    it('imports every order of a window with more than a page of them, once each', async () => {
      const orders = spreadOrders(250, WINDOW_START + 1, 80 * DAY_MS);
      const deps = makeDeps({ ...oneWindow, fetchPayHistory: serverOf(orders, shape) });

      const result = await sync(deps);

      expect(result.complete).toBe(true);
      expect(storedKeysOf(deps)).toHaveLength(250);
      expect(cursorWritesOf(deps).at(-1)).toBe(WINDOW_END);
    });

    it('imports every order of a same-millisecond tie that straddles a full page', async () => {
      const tie = Array.from({ length: 60 }, (_unused, index) =>
        order({ transactionId: `tie-${index}`, transactionTime: WINDOW_START + 10 * DAY_MS }),
      );
      const orders = [...tie, ...spreadOrders(90, WINDOW_START + 1, 80 * DAY_MS)];
      const deps = makeDeps({ ...oneWindow, fetchPayHistory: serverOf(orders, shape) });

      const result = await sync(deps);

      expect(result.complete).toBe(true);
      expect(storedKeysOf(deps)).toHaveLength(150);
    });
  });

  it('picks up on the next run when one run cannot get through the window, and never passes the capital cursor', async () => {
    const accountId = nextAccountId();
    const orders = spreadOrders(2000, FLOOR + 1, 80 * DAY_MS);
    let payCursor: number | null = null;
    const written: number[] = [];
    const runs: boolean[] = [];
    const imported = new Set<string>();

    for (let attempt = 0; attempt < 12 && runs.at(-1) !== true; attempt += 1) {
      const deps = makeDeps({
        listHoldings: async () => [spotAt(NOW, payCursor)],
        fetchPayHistory: serverOf(orders, { ascending: true, endExclusive: false }),
        addTransactions: jest.fn(async (rows: { externalId: string }[]) => {
          for (const row of rows) {
            imported.add(row.externalId);
          }

          return rows.length;
        }),
        writeWalkCursor: jest.fn(async (_id: string, _field: string, cursorMs: number) => {
          payCursor = cursorMs;
          written.push(cursorMs);
        }),
      });

      runs.push((await sync(deps, accountId)).complete);
    }

    expect(runs.length).toBeGreaterThan(1);
    expect(runs.slice(0, -1).every((complete) => !complete)).toBe(true);
    expect(runs.at(-1)).toBe(true);
    expect(imported.size).toBe(2000);
    expect(Math.max(...written)).toBeLessThanOrEqual(NOW);
    expect(written.every((cursor, index) => index === 0 || cursor >= written[index - 1])).toBe(
      true,
    );
  });
});

describe('the weight budget and the call cap', () => {
  it('stops after the window whose page left no UID room, keeping what committed', async () => {
    const deps = makeDeps({
      fetchPayHistory: jest.fn(async () =>
        payPage([order()], { usedUidWeight1m: UID_WEIGHT_BUDGET_1M - COSTS.pay.uid + 1 }),
      ),
    });

    const result = await sync(deps);

    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ imported: 1, complete: false });
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(1);
  });

  it('continues when the page left room for exactly one more call', async () => {
    const deps = makeDeps({
      fetchPayHistory: jest.fn(async () =>
        payPage([], { usedUidWeight1m: UID_WEIGHT_BUDGET_1M - COSTS.pay.uid }),
      ),
    });

    const result = await sync(deps);

    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(7);
    expect(result.complete).toBe(true);
  });

  it('counts the uid read against the same cap: 20 calls in all, none committed past it', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)],
      fetchPayHistory: jest.fn(async () => fullPage()),
    });

    const result = await sync(deps);

    expect(LANE_CALL_CAPS.pay).toBe(20);
    expect(deps.fetchAccount).toHaveBeenCalledTimes(1);
    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(19);
    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('makes no Pay request when the run has no call left for the uid read', async () => {
    const run = freshRun();

    for (let call = 0; call < LANE_CALL_CAPS.pay; call += 1) {
      run.budget.record('pay', { usedUidWeight1m: undefined, usedIpWeight1m: undefined });
    }

    const deps = makeDeps();

    const result = await sync(deps, nextAccountId(), run);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchAccount).not.toHaveBeenCalled();
    expect(deps.fetchPayHistory).not.toHaveBeenCalled();
  });

  it('counts the rows of a sub-window committed before the budget ran out', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)],
      fetchPayHistory: scripted([
        fullPage(),
        payPage([order()], { usedUidWeight1m: UID_WEIGHT_BUDGET_1M - COSTS.pay.uid + 1 }),
      ]),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 1, complete: false });
  });

  it('paces every request through the run gate', async () => {
    const sleeps: number[] = [];
    let clock = NOW;
    const run = createBinanceHistoryRun({
      now: () => clock,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        clock += milliseconds;
      },
    });

    await sync(makeDeps({ now: () => clock }), nextAccountId(), run);

    // 1 uid read + 7 Pay windows = 8 requests, 7 gaps.
    expect(sleeps).toHaveLength(7);
  });
});

describe('rate limits and failures', () => {
  it('sets the cooldown on a 429 in a window, keeps earlier windows, and reports behind', async () => {
    const accountId = nextAccountId();
    let calls = 0;
    const deps = makeDeps({
      fetchPayHistory: jest.fn(async () => {
        calls += 1;

        if (calls === 3) {
          throw new BinanceRateLimitError(429, 30_000);
        }

        return payPage([]);
      }),
    });

    const result = await sync(deps, accountId);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(2);
    expect(isBinanceCoolingDown(accountId, NOW + 29_000)).toBe(true);
    expect(isBinanceCoolingDown(accountId, NOW + 30_000)).toBe(false);
  });

  it('makes no request at all while the account is cooling down', async () => {
    const accountId = nextAccountId();
    setBinanceCooldownUntil(accountId, NOW + 60_000);
    const deps = makeDeps();

    const result = await sync(deps, accountId);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchAccount).not.toHaveBeenCalled();
    expect(deps.fetchPayHistory).not.toHaveBeenCalled();
  });

  it('sets the cooldown and stops when the uid read is rate limited', async () => {
    const accountId = nextAccountId();
    const deps = makeDeps({
      fetchAccount: jest.fn(async () => {
        throw new BinanceRateLimitError(418, 45_000);
      }),
    });

    const result = await sync(deps, accountId);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchPayHistory).not.toHaveBeenCalled();
    expect(isBinanceCoolingDown(accountId, NOW + 44_000)).toBe(true);
  });

  it('goes on without a uid when the uid read fails for any other reason, and says so once', async () => {
    const received = order({
      amount: '0.002',
      payerInfo: party('Bob', undefined),
      receiverInfo: party('Me', OWN),
    });
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)],
      fetchAccount: jest.fn(async () => {
        throw new Error('SECRET-BODY');
      }),
      fetchPayHistory: jest.fn(async () => payPage([received])),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_NOTICE, { name: 'BinanceWalkNotice', code: 'pay-uid-unavailable' }],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-BODY');
  });

  it('without a uid, a send whose sign disagrees with its shape stops instead of guessing', async () => {
    const odd = order({ amount: '0.001' });
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)],
      fetchAccount: jest.fn(async () => ({ balances: [], uid: null })),
      fetchPayHistory: jest.fn(async () => payPage([odd])),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
  });

  it('rejects, leaving earlier windows committed, on any other Pay failure', async () => {
    let calls = 0;
    const deps = makeDeps({
      fetchPayHistory: jest.fn(async () => {
        calls += 1;

        if (calls === 3) {
          throw new Error('Binance request failed: 401');
        }

        return payPage([]);
      }),
    });

    await expect(sync(deps)).rejects.toThrow('Binance request failed: 401');
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(2);
  });

  it('does not set a cooldown on a permission failure', async () => {
    const accountId = nextAccountId();
    const deps = makeDeps({
      fetchPayHistory: jest.fn(async () => {
        throw new Error('Binance request failed: 403');
      }),
    });

    await expect(sync(deps, accountId)).rejects.toThrow();
    expect(isBinanceCoolingDown(accountId, NOW)).toBe(false);
  });
});

describe('an order the walk cannot trust stops its window', () => {
  const recent = { listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)] };

  const readsOf = (...orders: BinancePayOrder[]): Partial<BinancePayHistoryDeps> => ({
    ...recent,
    fetchPayHistory: jest.fn(async () => payPage(orders)),
  });

  it('commits nothing of the window and logs one fixed code, with a good order beside the bad one', async () => {
    const deps = makeDeps(readsOf(order({ transactionId: 'good' }), order({ transactionId: '' })));

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-id-missing' }],
    ]);
  });

  it('stops on an amount of zero, which names no direction', async () => {
    const deps = makeDeps(readsOf(order({ amount: '0' })));

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-direction-ambiguous' }],
    ]);
  });

  it('logs no amount, id or name', async () => {
    const secretOrder = order({
      transactionId: 'ORDER-ID-777',
      amount: '0.123456',
      payerInfo: party('Secret Payer', '555'),
      receiverInfo: party('Secret Receiver', '666'),
    });
    const deps = makeDeps(readsOf(secretOrder));

    await sync(deps);

    const logged = JSON.stringify(warn.mock.calls);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logged).not.toMatch(/ORDER-ID-777|0\.123456|Secret|555|666/);
  });

  it('keeps the earlier window committed when a later one stops', async () => {
    let calls = 0;
    const deps = makeDeps({
      fetchPayHistory: jest.fn(async () => {
        calls += 1;

        return payPage(calls === 2 ? [order({ walletType: 4 })] : []);
      }),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-wallet-unknown' }],
    ]);
  });
});

describe('orders paid in other coins', () => {
  const recent = { listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)] };

  it('stops the window, cursor unmoved, on a non-BTC order paid with BTC funds', async () => {
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () =>
        payPage([order()], { hasBtcFundedOtherCoinOrder: true }),
      ),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-btc-funded-other-coin' }],
    ]);
  });

  it('commits the part of a full window before the order, and stops at the part holding it', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(FLOOR + PAY_WINDOW_MS)],
      fetchPayHistory: scripted([
        fullPage({ hasBtcFundedOtherCoinOrder: true }),
        payPage([order({ transactionId: 'clean' })]),
        payPage([], { hasBtcFundedOtherCoinOrder: true }),
      ]),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 1, complete: false });
    expect(cursorWritesOf(deps)).toEqual([FLOOR + Math.floor(PAY_WINDOW_MS / 2)]);
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-btc-funded-other-coin' }],
    ]);
  });
});

describe('wallet holdings (P7)', () => {
  const earnOrder = order({ walletType: 5 });

  it('creates a missing Earn holding at zero, then places the row on it', async () => {
    let created = false;
    const earn = holdingWith('h-earn', { binanceAsset: 'BTC:earn' });
    const deps = makeDeps({
      listHoldings: async () =>
        created ? [spotAt(NOW, NOW - 3_600_000), earn] : [spotAt(NOW, NOW - 3_600_000)],
      ensureHoldings: jest.fn(async () => {
        created = true;
      }),
      fetchPayHistory: jest.fn(async () => payPage([earnOrder])),
    });
    const accountId = nextAccountId();

    const result = await sync(deps, accountId);

    expect(deps.ensureHoldings).toHaveBeenCalledWith([
      {
        accountId,
        name: 'Binance Earn',
        type: 'crypto_asset',
        currency: 'BTC',
        balanceMinorUnits: 0,
        metadataField: 'binanceAsset',
        metadataKey: 'BTC:earn',
      },
    ]);
    expect(result).toEqual({ imported: 1, complete: true });
    expect(addedRows(deps)[0].holdingId).toBe('h-earn');
  });

  it('creates no holding for a window with no order', async () => {
    const deps = makeDeps();

    await sync(deps);

    expect(deps.ensureHoldings).not.toHaveBeenCalled();
  });

  it('stops the window when the holding is still absent after it was created', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)],
      fetchPayHistory: jest.fn(async () => payPage([earnOrder])),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-holding-missing' }],
    ]);
  });

  it('places the rows of a split order on their own wallets', async () => {
    const funding = holdingWith('h-funding', { binanceAsset: 'BTC:funding' });
    const split = order({
      walletTypes: [1, 2],
      fundsDetail: [
        {
          currency: 'BTC',
          amount: '0.001',
          walletAssetCost: [
            { walletType: 1, amount: '0.0006' },
            { walletType: 2, amount: '0.0004' },
          ],
        },
      ],
    });
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW, NOW - 3_600_000), funding],
      fetchPayHistory: jest.fn(async () => payPage([split])),
    });

    await sync(deps);

    expect(addedRows(deps).map((row) => [row.holdingId, row.amountMinorUnits])).toEqual([
      ['h-funding', -60_000],
      ['h-spot', -40_000],
    ]);
  });
});

describe('the overlap guard against stored capital rows', () => {
  const MINUTE_MS = 60_000;
  const TIME = NOW - 10 * DAY_MS;

  type StoredRow = {
    holdingId: string;
    suffix: string | null;
    amountMinorUnits: number;
    time: number;
  };

  const storedRow = (over: Partial<StoredRow>): StoredRow => ({
    holdingId: 'h-spot',
    suffix: 'deposit:9',
    amountMinorUnits: -100_000,
    time: TIME,
    ...over,
  });

  const runWith = async (
    stored: StoredRow[],
    orders: BinancePayOrder[] = [order({ transactionTime: TIME })],
  ) => {
    const accountId = nextAccountId();
    const deps = makeDeps({
      listHoldings: async () => [
        spotAt(NOW, NOW - 3_600_000),
        holdingWith('h-funding', { binanceAsset: 'BTC:funding' }),
      ],
      fetchPayHistory: jest.fn(async () => payPage(orders)),
      listHoldingTransactions: jest.fn(async (holdingId: string) =>
        stored
          .filter((row) => row.holdingId === holdingId)
          .map((row) => ({
            externalId: foldMap(maybe(row.suffix), (value) => `${accountId}:${value}`) ?? null,
            amountMinorUnits: row.amountMinorUnits,
            time: row.time,
          })),
      ),
    });
    const result = await sync(deps, accountId);

    return { deps, result };
  };

  it('skips a Pay row that repeats a capital row of the same size 9 minutes apart, and still commits the window', async () => {
    const { deps, result } = await runWith([storedRow({ time: TIME + 9 * MINUTE_MS })]);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_NOTICE, { name: 'BinanceWalkNotice', code: 'pay-overlap-skip' }],
    ]);
  });

  it('keeps a Pay row 11 minutes from a capital row', async () => {
    const { deps } = await runWith([storedRow({ time: TIME + 11 * MINUTE_MS })]);

    expect(addedRows(deps)).toHaveLength(1);
  });

  it('keeps a Pay row whose size or sign differs from the capital row', async () => {
    const otherSize = await runWith([storedRow({ amountMinorUnits: -100_001 })]);
    const otherSign = await runWith([storedRow({ amountMinorUnits: 100_000 })]);

    expect(otherSize.deps.addTransactions).toHaveBeenCalledTimes(1);
    expect(otherSign.deps.addTransactions).toHaveBeenCalledTimes(1);
  });

  it('matches a withdrawal as well as a deposit', async () => {
    const { deps } = await runWith([storedRow({ suffix: 'withdraw:3' })]);

    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('is no match for another source or for a Pay row of the same size', async () => {
    const { deps } = await runWith([
      storedRow({ suffix: null }),
      storedRow({ suffix: 'pay:C2C:old:2' }),
    ]);

    expect(addedRows(deps)).toHaveLength(1);
  });

  it('finds the capital row on a wallet the Pay order does not land on', async () => {
    const { deps } = await runWith([storedRow({ holdingId: 'h-funding' })]);

    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('skips only the closer of two same-size Pay orders beside one capital row', async () => {
    const near = order({ transactionId: 'near', transactionTime: TIME + MINUTE_MS });
    const far = order({ transactionId: 'far', transactionTime: TIME + 5 * MINUTE_MS });
    const { deps } = await runWith([storedRow({})], [far, near]);

    expect(addedRows(deps).map((row) => row.externalId.split(':').at(-2))).toEqual(['far']);
  });

  it('reads the rows of each wallet holding once for the whole run', async () => {
    const orders = [order({ transactionId: 'one' }), order({ transactionId: 'two' })];
    const { deps } = await runWith([], orders);

    expect(
      (deps.listHoldingTransactions as jest.Mock).mock.calls.map((call) => call[0]).sort(),
    ).toEqual(['h-funding', 'h-spot']);
  });
});
