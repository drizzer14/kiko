import { DAY_MS } from '@kiko/dates';
import {
  binanceWalkPendingOf,
  withWalkOwnedMetadataResetToFloor,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';

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
  type UnreadableRow,
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';
import { HISTORY_FLOOR_MS } from './binance.transactions';
import type { OwedGround, WalkWindow } from './binance.history-walk';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { costOn, NOW, OTHER, OWN, party, payOrder } from './binance.pay-test-fixtures';

const order = payOrder;
const WARN_TAG_STOP = '[binance sync] history window stopped';
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
  unreadable: [],
  gathered: rows.length,
  btcFundedOtherCoinOrders: [],
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  ...over,
});

const fullPage = (over: Partial<PayHistoryPage> = {}): PayHistoryPage =>
  payPage([], { gathered: PAY_PAGE_LIMIT, ...over });

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

/**
 * The Spot holding of a connected account. It carries no capital cursor: the Pay walk does
 * not read one.
 */
const spotAt = (
  payCursor: number | null = null,
  rescanCursor: number | null = null,
  pending?: WalkWindow[],
  pointCursor: number | null = null,
): HoldingRow =>
  holdingWith('h-spot', {
    binanceAsset: 'BTC',
    binancePayHistoryCursor: payCursor ?? undefined,
    binancePayRescanCursor: rescanCursor ?? undefined,
    binancePayPendingOverlap: pending,
    binancePayPointCursor: pointCursor ?? undefined,
  });

const makeDeps = (over: Partial<BinancePayHistoryDeps> = {}): BinancePayHistoryDeps => ({
  now: () => NOW,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  listHoldings: async () => [spotAt()],
  fetchAccount: jest.fn(async () => ({ balances: [], uid: OWN })),
  fetchPayHistory: jest.fn(async () => payPage([])),
  ensureHoldings: jest.fn(async () => undefined),
  addTransactions: jest.fn(async (rows: unknown[]) => rows.length),
  writeWalkCursor: jest.fn(async () => undefined),
  writeWalkPending: jest.fn(async () => undefined),
  writeWalkHints: jest.fn(async () => undefined),
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

const FORWARD_CURSOR_FIELD = 'binancePayHistoryCursor';

/** The values written to the forward cursor, in order; the re-scan mark is another field. */
const cursorWritesOf = (deps: BinancePayHistoryDeps): number[] =>
  (deps.writeWalkCursor as jest.Mock).mock.calls
    .filter((call) => call[1] === FORWARD_CURSOR_FIELD)
    .map((call) => call[2] as number);

/** The pages of a scripted history, in order; an empty page once they run out. */
const scripted = (pages: PayHistoryPage[]) => jest.fn(async () => pages.shift() ?? payPage([]));

/**
 * A read that gives `page` to the forward pass (a span that starts at `cursorMs` or later) and an
 * empty page to every span behind it, so a stop of the forward pass is the only thing to see.
 */
const forwardPageOf = (cursorMs: number, page: PayHistoryPage) =>
  jest.fn(async (_apiKey: string, _secret: string, query: { startTime: number }) =>
    query.startTime >= cursorMs ? page : payPage([]),
  );

type ServerShape = { ascending: boolean; endExclusive: boolean };

type PayRead = (apiKey: string, secret: string, query: PayQuery) => Promise<PayHistoryPage>;

/** `read` for the forward pass (spans that start at `cursorMs` or later), no order behind it. */
const forwardOnly = (cursorMs: number, read: PayRead) =>
  jest.fn(async (apiKey: string, secret: string, query: PayQuery) =>
    query.startTime >= cursorMs ? read(apiKey, secret, query) : payPage([]),
  );

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
    const deps = makeDeps({ listHoldings: async () => [spotAt(HISTORY_FLOOR_MS)] });

    await sync(deps);

    expect(queriesOf(deps)[0].startTime).toBe(payFloorMs(NOW));
    expect(Math.min(...queriesOf(deps).map((query) => query.startTime))).toBe(payFloorMs(NOW));
  });

  // Binance answers a Pay startTime older than about 548 days with HTTP 400, code 403004,
  // so no pass may send one, whatever the stored cursors say.
  it.each([
    ['no cursor at all', null, null],
    ['both cursors reset to 2017 by a disconnect', HISTORY_FLOOR_MS, HISTORY_FLOOR_MS],
    ['a forward cursor older than the floor', NOW - 600 * DAY_MS, null],
    ['a re-scan cursor older than the floor', NOW - 2 * DAY_MS, NOW - 600 * DAY_MS],
    ['a re-scan cursor of 2017 behind a recent forward cursor', NOW - 2 * DAY_MS, HISTORY_FLOOR_MS],
    ['an old forward cursor and an old re-scan cursor', NOW - 520 * DAY_MS, NOW - 530 * DAY_MS],
  ])(
    'sends no startTime before the Pay floor, with %s',
    async (_label, payCursor, rescanCursor) => {
      const deps = makeDeps({ listHoldings: async () => [spotAt(payCursor, rescanCursor)] });

      await sync(deps);

      expect(queriesOf(deps).length).toBeGreaterThan(0);
      expect(Math.min(...queriesOf(deps).map((query) => query.startTime))).toBeGreaterThanOrEqual(
        payFloorMs(NOW),
      );
    },
  );

  it('walks forward from a cursor that is nearly caught up, then re-scans the window behind it', async () => {
    const cursor = NOW - 3_600_000;
    const deps = makeDeps({ listHoldings: async () => [spotAt(cursor)] });

    await sync(deps);

    expect(queriesOf(deps)).toEqual([
      { startTime: cursor, endTime: NOW },
      { startTime: NOW - PAY_WINDOW_MS, endTime: cursor },
    ]);
  });

  it('walks forward from a cursor that is older than a window, then re-scans the overlap day behind it', async () => {
    const cursor = NOW - 120 * DAY_MS;
    const deps = makeDeps({ listHoldings: async () => [spotAt(cursor)] });

    await sync(deps);

    const queries = queriesOf(deps);
    expect(queries[0].startTime).toBe(cursor);
    expect(queries.at(-1)).toEqual({ startTime: cursor - DAY_MS, endTime: cursor });
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

describe('the walk and the capital walk', () => {
  it('ends the newest window at now and commits it', async () => {
    const deps = makeDeps({ listHoldings: async () => [spotAt(NOW - 3_600_000)] });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(queriesOf(deps)[0].endTime).toBe(NOW);
    expect(deps.writeWalkCursor).toHaveBeenLastCalledWith('h-spot', 'binancePayHistoryCursor', NOW);
  });

  it('runs with a Spot holding that has no capital watermark, and reads none', async () => {
    const spot = spotAt();
    const deps = makeDeps({ listHoldings: async () => [spot] });

    const result = await sync(deps);

    expect(spot.metadata).not.toHaveProperty('binanceHistoryCursor');
    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.fetchAccount).toHaveBeenCalledTimes(1);
    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(7);
    expect(queriesOf(deps).at(-1)?.endTime).toBe(NOW);
  });

  it('starts the next run from the cursor it left', async () => {
    const written: number[] = [];
    const first = makeDeps({
      writeWalkCursor: jest.fn(async (_id: string, _field: string, cursorMs: number) => {
        written.push(cursorMs);
      }),
    });
    await sync(first);

    const later = NOW + 2 * DAY_MS;
    const second = makeDeps({
      now: () => later,
      listHoldings: async () => [spotAt(written.at(-1))],
    });
    await sync(second);

    expect(written.at(-1)).toBe(NOW);
    expect(queriesOf(second)).toEqual([
      { startTime: NOW, endTime: later },
      { startTime: later - PAY_WINDOW_MS, endTime: NOW },
    ]);
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
  const recent = { listHoldings: async () => [spotAt(NOW - 3_600_000)] };

  it('maps an outgoing order onto Spot, signed, with the nickname and the account-keyed id', async () => {
    const accountId = nextAccountId();
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: scripted([payPage([order()])]),
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

    // The last request is the re-scan behind the forward pass; it finds the order again, and
    // the (source, external_id) upsert makes that harmless.
    expect(calls).toEqual([
      'fetchPayHistory',
      'addTransactions',
      'writeWalkCursor',
      'fetchPayHistory',
      'addTransactions',
    ]);
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
  // The cursor sits at the start of the newest window, so the forward pass is exactly that
  // one window, and the only ground behind it to re-scan is the overlap day.
  const WINDOW_START = NOW - PAY_WINDOW_MS;
  const WINDOW_END = NOW;
  const oneWindow = { listHoldings: async () => [spotAt(WINDOW_START)] };
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
      writeWalkCursor: jest.fn(async (_id: string, field: string, cursorMs: number) => {
        if (field === FORWARD_CURSOR_FIELD) {
          calls.push(`cursor ${cursorMs - WINDOW_START}`);
        }
      }),
    });

    const result = await sync(deps);

    expect(queriesOf(deps)).toEqual([
      { startTime: WINDOW_START, endTime: WINDOW_END },
      { startTime: WINDOW_START, endTime: WINDOW_START + HALF },
      { startTime: WINDOW_START + HALF, endTime: WINDOW_END },
      { startTime: WINDOW_START - DAY_MS, endTime: WINDOW_START },
    ]);
    expect(calls).toEqual([
      'fetch',
      'fetch',
      'add',
      `cursor ${HALF}`,
      'fetch',
      'add',
      `cursor ${PAY_WINDOW_MS}`,
      'fetch',
    ]);
    expect(result).toEqual({ imported: 2, complete: true });
  });

  it('halves a window from a cursor older than the window, and no forward span starts behind it', async () => {
    // Seven halvings of the 89-day window the walk starts at the cursor.
    const cursor = NOW - 120 * DAY_MS;
    const deps = makeDeps({
      listHoldings: async () => [spotAt(cursor)],
      fetchPayHistory: scripted([...Array.from({ length: 7 }, () => fullPage()), payPage([])]),
    });

    await sync(deps);

    const written = cursorWritesOf(deps);
    expect(
      queriesOf(deps)
        .slice(0, 8)
        .every((query) => query.startTime >= cursor),
    ).toBe(true);
    expect(written[0]).toBeGreaterThan(cursor);
    expect(written.every((value, index) => index === 0 || value >= written[index - 1])).toBe(true);
  });

  it('counts a full page of other coins as a full page, so their orders cannot end the window early', async () => {
    const deps = makeDeps({
      ...oneWindow,
      fetchPayHistory: scripted([fullPage(), payPage([order()]), payPage([])]),
    });

    const result = await sync(deps);

    // Three requests walk the window; the fourth re-scans the overlap day behind it.
    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(4);
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
      listHoldings: async () => [spotAt(NOW - 8)],
      fetchPayHistory: serverOf(spreadOrders(PAY_PAGE_LIMIT + 50, NOW - 3, 0), {
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
      listHoldings: async () => [spotAt(NOW - 2)],
      fetchPayHistory: forwardOnly(
        NOW - 2,
        serverOf(spreadOrders(PAY_PAGE_LIMIT + 50, NOW - 2, 0), {
          ascending: true,
          endExclusive: false,
        }),
      ),
    });

    const result = await sync(deps);

    expect(queriesOf(deps).filter((query) => query.startTime >= NOW - 2)).toEqual([
      { startTime: NOW - 2, endTime: NOW },
      { startTime: NOW - 2, endTime: NOW - 1 },
    ]);
    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-page-stuck' }],
    ]);
  });

  it('keeps what committed before the sub-window that cannot be split', async () => {
    const early = order({ transactionId: 'early', transactionTime: NOW - 7 });
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW - 8)],
      fetchPayHistory: serverOf([early, ...spreadOrders(PAY_PAGE_LIMIT + 50, NOW - 3, 0)], {
        ascending: false,
        endExclusive: false,
      }),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 1, complete: false });
    expect(storedKeysOf(deps)).toHaveLength(1);
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(1);
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

  it('picks up on the next run when one run cannot get through the window, and never passes now', async () => {
    const accountId = nextAccountId();
    const orders = spreadOrders(2000, FLOOR + 1, 80 * DAY_MS);
    let payCursor: number | null = null;
    const written: number[] = [];
    const runs: boolean[] = [];
    const imported = new Set<string>();

    for (let attempt = 0; attempt < 12 && runs.at(-1) !== true; attempt += 1) {
      const deps = makeDeps({
        listHoldings: async () => [spotAt(payCursor)],
        fetchPayHistory: serverOf(orders, { ascending: true, endExclusive: false }),
        addTransactions: jest.fn(async (rows: { externalId: string }[]) => {
          for (const row of rows) {
            imported.add(row.externalId);
          }

          return rows.length;
        }),
        writeWalkCursor: jest.fn(async (_id: string, field: string, cursorMs: number) => {
          if (field === FORWARD_CURSOR_FIELD) {
            payCursor = cursorMs;
            written.push(cursorMs);
          }
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

describe('forward progress on a busy account', () => {
  const FORWARD_FIELD = 'binancePayHistoryCursor';
  const RESCAN_FIELD = 'binancePayRescanCursor';
  const ASCENDING = { ascending: true, endExclusive: false };

  type WalkState = {
    accountId: string;
    payCursor: number | null;
    rescanCursor: number | null;
    pending: WalkWindow[];
    imported: Set<string>;
    writes: [string, number][];
    // Every write to the walk's marks in order, by field, to pin what goes before what.
    order: string[];
  };

  const PENDING_FIELD = 'binancePayPendingOverlap';

  const freshState = (over: Partial<WalkState> = {}): WalkState => ({
    accountId: nextAccountId(),
    payCursor: null,
    rescanCursor: null,
    pending: [],
    imported: new Set(),
    writes: [],
    order: [],
    ...over,
  });

  /**
   * One run over the stored state; a key the state already holds is not imported again.
   * `over` replaces a dep, for a run a test cuts short.
   */
  const runOver = async (
    state: WalkState,
    orders: BinancePayOrder[],
    run = freshRun(),
    at = NOW,
    over: Partial<BinancePayHistoryDeps> = {},
  ) => {
    const deps = makeDeps({
      now: () => at,
      listHoldings: async () => [spotAt(state.payCursor, state.rescanCursor, state.pending)],
      fetchPayHistory: serverOf(orders, ASCENDING),
      addTransactions: jest.fn(async (rows: { externalId: string }[]) => {
        const fresh = rows.filter((row) => !state.imported.has(row.externalId));

        for (const row of fresh) {
          state.imported.add(row.externalId);
        }

        return fresh.length;
      }),
      writeWalkCursor: jest.fn(async (_id: string, field: string, cursorMs: number) => {
        state.writes.push([field, cursorMs]);
        state.order.push(field);

        if (field === FORWARD_FIELD) {
          state.payCursor = cursorMs;
        } else if (field === RESCAN_FIELD) {
          state.rescanCursor = cursorMs;
        }
      }),
      writeWalkPending: jest.fn(async (_id: string, _field: string, ranges: WalkWindow[]) => {
        state.pending = ranges;
        state.order.push(PENDING_FIELD);
      }),
      ...over,
    });

    return { deps, result: await sync(deps, state.accountId, run) };
  };

  const writesTo = (state: WalkState, field: string): number[] =>
    state.writes.filter(([written]) => written === field).map(([, cursorMs]) => cursorMs);

  // 900 orders over the last 88 days, the cursor 2 days behind: more than one run's calls reach.
  const busyOrders = spreadOrders(900, NOW - 88 * DAY_MS, 88 * DAY_MS);
  const busyState = () => freshState({ payCursor: NOW - 2 * DAY_MS });

  it('imports the newest orders on the first run, and the forward cursor reaches the end', async () => {
    const state = busyState();

    const { result } = await runOver(state, busyOrders);

    const newest = busyOrders.filter((candidate) => candidate.transactionTime >= NOW - 2 * DAY_MS);
    expect(newest.length).toBeGreaterThan(0);
    expect(
      newest.every((candidate) =>
        state.imported.has(`${state.accountId}:pay:C2C:${candidate.transactionId}:2`),
      ),
    ).toBe(true);
    expect(state.payCursor).toBe(NOW);
    expect(result.complete).toBe(false);
  });

  it('spends the forward pass first, then re-scans the window behind it', async () => {
    const state = busyState();

    const { deps } = await runOver(state, busyOrders);

    const queries = queriesOf(deps);
    expect(queries[0]).toEqual({ startTime: NOW - 2 * DAY_MS, endTime: NOW });
    expect(queries[1].startTime).toBe(NOW - PAY_WINDOW_MS);
    expect(queries.slice(1).every((query) => query.endTime <= NOW - 2 * DAY_MS)).toBe(true);
  });

  it('never moves the forward cursor back while it re-scans, and never passes the end', async () => {
    const state = busyState();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await runOver(state, busyOrders);
    }

    const forward = writesTo(state, FORWARD_FIELD);
    expect(writesTo(state, RESCAN_FIELD).length).toBeGreaterThan(1);
    expect(forward.every((cursor, index) => index === 0 || cursor >= forward[index - 1])).toBe(
      true,
    );
    expect(Math.max(...forward)).toBe(NOW);
    expect(state.payCursor).toBe(NOW);
  });

  it('finishes the re-scan over later runs, imports every order once, and resets its mark', async () => {
    const state = busyState();
    const runs: boolean[] = [];

    for (let attempt = 0; attempt < 12 && runs.at(-1) !== true; attempt += 1) {
      runs.push((await runOver(state, busyOrders)).result.complete);
    }

    expect(runs.length).toBeGreaterThan(1);
    expect(runs.at(-1)).toBe(true);
    expect(state.imported.size).toBe(900);
    expect(state.rescanCursor).toBe(HISTORY_FLOOR_MS);
  });

  it('imports nothing on a run after the re-scan finished: a second identical run is idempotent', async () => {
    const state = busyState();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await runOver(state, busyOrders);
    }

    const again = await runOver(state, busyOrders);
    const afterThat = await runOver(state, busyOrders);

    expect(state.imported.size).toBe(900);
    expect(again.result.imported).toBe(0);
    expect(afterThat.result.imported).toBe(0);
  });

  it('resumes the re-scan from its stored cursor', async () => {
    const state = freshState({ payCursor: NOW - 2 * DAY_MS, rescanCursor: NOW - 40 * DAY_MS });

    const { deps } = await runOver(state, []);

    expect(queriesOf(deps)).toEqual([
      { startTime: NOW - 2 * DAY_MS, endTime: NOW },
      { startTime: NOW - 40 * DAY_MS, endTime: NOW - 2 * DAY_MS },
    ]);
  });

  it('writes the re-scan cursor at the end of each committed re-scan span, and nothing else to it', async () => {
    const state = freshState({ payCursor: NOW - 2 * DAY_MS });
    const orders = spreadOrders(180, NOW - 88 * DAY_MS, 88 * DAY_MS);

    const { deps } = await runOver(state, orders);

    const rescanQueries = queriesOf(deps).slice(1);
    const mid = writesTo(state, RESCAN_FIELD).slice(0, -1);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.every((cursor) => rescanQueries.some((query) => query.endTime === cursor))).toBe(
      true,
    );
  });

  it('starts a new pass at the window start once the stored cursor is the restart mark', async () => {
    const state = freshState({ payCursor: NOW - 2 * DAY_MS, rescanCursor: HISTORY_FLOOR_MS });

    const { deps, result } = await runOver(state, []);

    expect(queriesOf(deps)[1].startTime).toBe(NOW - PAY_WINDOW_MS);
    expect(result.complete).toBe(true);
    expect(writesTo(state, RESCAN_FIELD)).toEqual([]);
  });

  it('writes the restart mark when a resumed re-scan reaches the forward start', async () => {
    const state = freshState({ payCursor: NOW - 2 * DAY_MS, rescanCursor: NOW - 40 * DAY_MS });

    await runOver(state, []);

    expect(writesTo(state, RESCAN_FIELD)).toEqual([HISTORY_FLOOR_MS]);
  });

  it('writes no re-scan cursor on a light account that has no pass in progress', async () => {
    const state = freshState({ payCursor: NOW - 3_600_000 });

    const { result } = await runOver(state, []);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(writesTo(state, RESCAN_FIELD)).toEqual([]);
  });

  it('reads nothing behind the cursor while the forward pass is still going, and keeps the overlap day owed', async () => {
    const state = freshState({ payCursor: NOW - 120 * DAY_MS });

    const { deps } = await runOver(state, spreadOrders(2000, NOW - 119 * DAY_MS, 80 * DAY_MS));

    expect(queriesOf(deps).every((query) => query.startTime >= NOW - 120 * DAY_MS)).toBe(true);
    expect(writesTo(state, RESCAN_FIELD)).toEqual([]);
    expect(state.pending).toEqual([{ start: NOW - 121 * DAY_MS, end: NOW - 120 * DAY_MS }]);
  });

  it('does not re-scan at all after a disconnect reset every cursor to the floor', async () => {
    const state = freshState({ payCursor: HISTORY_FLOOR_MS, rescanCursor: HISTORY_FLOOR_MS });

    const { deps } = await runOver(state, []);

    expect(queriesOf(deps)[0].startTime).toBe(payFloorMs(NOW));
    expect(writesTo(state, RESCAN_FIELD)).toEqual([]);
  });

  describe('with a dense day just behind the cursor', () => {
    // 900 orders fill the day before the cursor: more calls than one run affords. A forward
    // pass that restarted a day behind the cursor would spend every run on that day, and the
    // cursor, which only a span ending after it moves, would never reach the newer orders.
    const CURSOR = NOW - 2 * DAY_MS;
    const denseDay = spreadOrders(900, CURSOR - DAY_MS, DAY_MS);
    const newer = [1, 2, 3].map((hours) =>
      order({ transactionId: `newer-${hours}`, transactionTime: CURSOR + hours * 3_600_000 }),
    );
    const denseOrders = [...denseDay, ...newer];
    const denseState = () => freshState({ payCursor: CURSOR });

    const runUntilComplete = async (state: WalkState): Promise<boolean[]> => {
      const runs: boolean[] = [];

      for (let attempt = 0; attempt < 30 && runs.at(-1) !== true; attempt += 1) {
        runs.push((await runOver(state, denseOrders)).result.complete);
      }

      return runs;
    };

    it('imports the orders after the cursor and moves the cursor to the end on the first run', async () => {
      const state = denseState();

      const { deps } = await runOver(state, denseOrders);

      expect(
        newer.every((candidate) =>
          state.imported.has(`${state.accountId}:pay:C2C:${candidate.transactionId}:2`),
        ),
      ).toBe(true);
      expect(state.payCursor).toBe(NOW);
      expect(queriesOf(deps)[0]).toEqual({ startTime: CURSOR, endTime: NOW });
    });

    it('still re-scans the dense day over later runs, importing every order once', async () => {
      const state = denseState();

      const runs = await runUntilComplete(state);

      expect(runs.length).toBeGreaterThan(1);
      expect(runs.at(-1)).toBe(true);
      expect(state.imported.size).toBe(denseOrders.length);
      expect(state.rescanCursor).toBe(HISTORY_FLOOR_MS);
    });

    it('imports nothing on a second identical run after the re-scan finished', async () => {
      const state = denseState();
      await runUntilComplete(state);

      const again = await runOver(state, denseOrders);

      expect(again.result.imported).toBe(0);
      expect(state.imported.size).toBe(denseOrders.length);
    });
  });

  describe('with a cursor older than the re-scan window', () => {
    const CURSOR = NOW - 120 * DAY_MS;
    const keyOf = (state: WalkState, candidate: BinancePayOrder): string =>
      `${state.accountId}:pay:C2C:${candidate.transactionId}:2`;

    const runUntilComplete = async (
      state: WalkState,
      ordersOf: (attempt: number) => BinancePayOrder[],
    ) => {
      const runs: boolean[] = [];

      for (let attempt = 0; attempt < 30 && runs.at(-1) !== true; attempt += 1) {
        runs.push((await runOver(state, ordersOf(attempt))).result.complete);
      }

      return runs;
    };

    // 900 orders fill the day behind the cursor. A forward pass that restarted the overlap
    // behind the cursor would spend every run on that day, and never reach the newer orders.
    it('reaches now and imports every order once, with a dense day just behind the cursor', async () => {
      const denseDay = spreadOrders(900, CURSOR - DAY_MS, DAY_MS);
      const newer = [1, 2, 3].map((hours) =>
        order({ transactionId: `newer-${hours}`, transactionTime: CURSOR + hours * 3_600_000 }),
      );
      const state = freshState({ payCursor: CURSOR });

      const first = await runOver(state, [...denseDay, ...newer]);
      const runs = [first.result.complete];

      expect(state.payCursor).toBe(NOW);
      expect(newer.every((candidate) => state.imported.has(keyOf(state, candidate)))).toBe(true);

      for (let attempt = 0; attempt < 30 && runs.at(-1) !== true; attempt += 1) {
        runs.push((await runOver(state, [...denseDay, ...newer])).result.complete);
      }

      expect(runs.at(-1)).toBe(true);
      expect(runs.length).toBeLessThanOrEqual(6);
      expect(state.imported.size).toBe(denseDay.length + newer.length);
      expect(state.rescanCursor).toBe(HISTORY_FLOOR_MS);
    });

    // The order was pending at the last sync, so it was missing then and settles in the
    // overlap day behind the cursor; the walk was away for 88.5 days, so the window start
    // cuts that day in two.
    it('imports an order that settled late in the overlap day, after an absence of 88.5 days', async () => {
      const lateCursor = NOW - 88.5 * DAY_MS;
      const late = order({ transactionId: 'late', transactionTime: lateCursor - 0.75 * DAY_MS });
      const state = freshState({ payCursor: lateCursor });

      await runOver(state, [late]);

      expect(state.imported.has(keyOf(state, late))).toBe(true);
    });

    it('imports an order that settled late behind the old cursor, though the catch-up took several runs', async () => {
      const late = order({ transactionId: 'late', transactionTime: CURSOR - 0.5 * DAY_MS });
      const busy = spreadOrders(2000, CURSOR + 1, 80 * DAY_MS);
      const state = freshState({ payCursor: CURSOR });

      const runs = await runUntilComplete(state, (attempt) =>
        attempt === 0 ? busy : [...busy, late],
      );

      expect(runs.length).toBeGreaterThan(2);
      expect(runs.at(-1)).toBe(true);
      expect(state.payCursor).toBe(NOW);
      expect(state.imported.size).toBe(busy.length + 1);
      expect(state.imported.has(keyOf(state, late))).toBe(true);
    });

    it('stores the owed overlap day behind the old cursor before it moves the cursor', async () => {
      const state = freshState({ payCursor: CURSOR });

      await runOver(state, spreadOrders(2000, CURSOR + 1, 80 * DAY_MS));

      expect(state.pending).toEqual([{ start: CURSOR - DAY_MS, end: CURSOR }]);
      expect(state.order.slice(0, 2)).toEqual([PENDING_FIELD, FORWARD_FIELD]);
    });

    // A re-scan mark the sliding window has outrun is a pass the window does not reach any
    // more: the run starts a new pass at the window start, so a record in the window behind
    // the cursor is read at once, wherever the old mark lay.
    it('starts a new pass at the window start for a mark the window outran, whatever the distance', async () => {
      const late = order({ transactionId: 'late', transactionTime: NOW - 5 * DAY_MS });
      const state = freshState({ payCursor: NOW, rescanCursor: CURSOR });

      await runOver(state, [late]);

      expect(state.imported.has(keyOf(state, late))).toBe(true);
    });
  });
});

describe('the pending overlap days of a walk', () => {
  const FORWARD_FIELD = 'binancePayHistoryCursor';
  const RESCAN_FIELD = 'binancePayRescanCursor';
  const ASCENDING = { ascending: true, endExclusive: false };
  const SUSPENDED = 'run suspended';

  const POINT_FIELD = 'binancePayPointCursor';

  type PendingState = {
    accountId: string;
    payCursor: number | null;
    rescanCursor: number | null;
    pointCursor: number | null;
    pending: OwedGround[];
    imported: Set<string>;
  };

  const stateOf = (over: Partial<PendingState> = {}): PendingState => ({
    accountId: nextAccountId(),
    payCursor: null,
    rescanCursor: null,
    pointCursor: null,
    pending: [],
    imported: new Set(),
    ...over,
  });

  const keyOf = (state: PendingState, candidate: BinancePayOrder): string =>
    `${state.accountId}:pay:C2C:${candidate.transactionId}:2`;

  /** A server that answers `after` calls, then fails as a run killed between two requests. */
  const suspendedAfter = (after: number, orders: BinancePayOrder[]) => {
    const inner = serverOf(orders, ASCENDING);
    let calls = 0;

    return jest.fn(async (apiKey: string, secret: string, query: PayQuery) => {
      calls += 1;

      if (calls > after) {
        throw new Error(SUSPENDED);
      }

      return inner(apiKey, secret, query);
    });
  };

  const runOver = async (
    state: PendingState,
    orders: BinancePayOrder[],
    at = NOW,
    over: Partial<BinancePayHistoryDeps> = {},
  ) => {
    const deps = makeDeps({
      now: () => at,
      listHoldings: async () => [
        spotAt(state.payCursor, state.rescanCursor, state.pending, state.pointCursor),
      ],
      fetchPayHistory: serverOf(orders, ASCENDING),
      addTransactions: jest.fn(async (rows: { externalId: string }[]) => {
        const fresh = rows.filter((row) => !state.imported.has(row.externalId));

        for (const row of fresh) {
          state.imported.add(row.externalId);
        }

        return fresh.length;
      }),
      writeWalkCursor: jest.fn(async (_id: string, field: string, cursorMs: number) => {
        if (field === FORWARD_FIELD) {
          state.payCursor = cursorMs;
        } else if (field === RESCAN_FIELD) {
          state.rescanCursor = cursorMs;
        } else if (field === POINT_FIELD) {
          state.pointCursor = cursorMs;
        }
      }),
      writeWalkPending: jest.fn(async (_id: string, _field: string, ranges: OwedGround[]) => {
        state.pending = ranges;
      }),
      ...over,
    });

    return { deps, result: await sync(deps, state.accountId, freshRun()) };
  };

  const runUntilComplete = async (
    state: PendingState,
    ordersOf: (attempt: number) => BinancePayOrder[],
    at = NOW,
  ) => {
    const runs: boolean[] = [];

    for (let attempt = 0; attempt < 30 && runs.at(-1) !== true; attempt += 1) {
      runs.push((await runOver(state, ordersOf(attempt), at)).result.complete);
    }

    return runs;
  };

  // The order was pending at each sync, so it settles after the sync that set the cursor, in
  // the overlap day behind that cursor. Two absences longer than the window, with the run cut
  // between its forward pass and its re-scan, leave the first cursor's day behind a window
  // that stops short of it.
  it('reads the overlap day of each of two cursors after two absences longer than the window, the first run cut after its forward pass', async () => {
    const firstRunAt = NOW - 95 * DAY_MS;
    const firstCursor = firstRunAt - 95 * DAY_MS;
    const lateBehindFirst = order({
      transactionId: 'late-first',
      transactionTime: firstCursor - 0.5 * DAY_MS,
    });
    const lateBehindSecond = order({
      transactionId: 'late-second',
      transactionTime: firstRunAt - 0.5 * DAY_MS,
    });
    const state = stateOf({ payCursor: firstCursor });

    await expect(
      runOver(state, [], firstRunAt, { fetchPayHistory: suspendedAfter(2, []) }),
    ).rejects.toThrow(SUSPENDED);
    expect(state.payCursor).toBe(firstRunAt);

    await runOver(state, [lateBehindFirst, lateBehindSecond]);

    expect(state.imported.has(keyOf(state, lateBehindFirst))).toBe(true);
    expect(state.imported.has(keyOf(state, lateBehindSecond))).toBe(true);
  });

  it('reads the overlap day of a cursor 250 days stale on an account too dense to catch up in one run', async () => {
    const cursor = NOW - 250 * DAY_MS;
    const late = order({ transactionId: 'late', transactionTime: cursor - 0.5 * DAY_MS });
    const busy = spreadOrders(3000, cursor + 1, 245 * DAY_MS);
    const state = stateOf({ payCursor: cursor });

    const runs = await runUntilComplete(state, (attempt) =>
      attempt === 0 ? busy : [...busy, late],
    );

    expect(runs.length).toBeGreaterThan(2);
    expect(runs.at(-1)).toBe(true);
    expect(state.payCursor).toBe(NOW);
    expect(state.imported.has(keyOf(state, late))).toBe(true);
    expect(state.imported.size).toBe(busy.length + 1);
    expect(state.pending).toEqual([]);
  });

  it('goes on past a one-millisecond span of the re-scan that is still full, owing that span', async () => {
    // The re-scan resumes 200 ms behind the cursor, so the halving reaches one millisecond within
    // the calls of one run.
    const cursor = NOW - 2 * DAY_MS;
    const crowdedAt = cursor - 100;
    const earlier = order({ transactionId: 'earlier', transactionTime: crowdedAt - 80 });
    const later = order({ transactionId: 'later', transactionTime: crowdedAt + 80 });
    const state = stateOf({ payCursor: cursor, rescanCursor: cursor - 200 });
    const orders = [earlier, later, ...spreadOrders(PAY_PAGE_LIMIT + 50, crowdedAt, 0)];

    // Runs at the cursor's own time, so no forward window moves the re-scan's end.
    await runOver(state, [], cursor, { fetchPayHistory: serverOf(orders, ASCENDING) });
    const { result } = await runOver(state, [], cursor, {
      fetchPayHistory: serverOf(orders, ASCENDING),
    });

    expect(state.imported.has(keyOf(state, earlier))).toBe(true);
    expect(state.imported.has(keyOf(state, later))).toBe(true);
    // The spans a read left whole are ranges, and two that touch are one range.
    expect(state.pending.length).toBeGreaterThan(0);
    expect(
      state.pending.every(
        (range) =>
          range.kind === undefined &&
          range.end - range.start <= 2 &&
          range.start <= crowdedAt &&
          crowdedAt <= range.end,
      ),
    ).toBe(true);
    expect(result.complete).toBe(false);
  });

  it('keeps a stopped day owed, and still reads the other owed days and the window re-scan', async () => {
    const stuckDay = { start: NOW - 300 * DAY_MS, end: NOW - 299 * DAY_MS };
    const readableDay = { start: NOW - 200 * DAY_MS, end: NOW - 199 * DAY_MS };
    const stuck = order({ transactionId: '', transactionTime: stuckDay.start + 3_600_000 });
    const readable = order({ transactionId: 'readable', transactionTime: readableDay.start + 1 });
    const inWindow = order({ transactionId: 'in-window', transactionTime: NOW - 5 * DAY_MS });
    const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay, readableDay] });

    const first = await runOver(state, [stuck, readable, inWindow]);
    const second = await runOver(state, [stuck, readable, inWindow]);

    expect(first.result.complete).toBe(false);
    expect(state.imported.has(keyOf(state, readable))).toBe(true);
    expect(state.imported.has(keyOf(state, inWindow))).toBe(true);
    expect(state.imported.has(keyOf(state, stuck))).toBe(false);
    expect(state.pending).toEqual([
      { start: stuck.transactionTime - 1, end: stuck.transactionTime + 1, kind: 'point' },
    ]);
    expect(second.result.complete).toBe(false);
  });

  it('asks for the owed days oldest first, after the forward pass, then the window, and reads the stuck order alone on the next run', async () => {
    const stuckDay = { start: NOW - 300 * DAY_MS, end: NOW - 299 * DAY_MS };
    const readableDay = { start: NOW - 200 * DAY_MS, end: NOW - 199 * DAY_MS };
    const stuck = order({ transactionId: '', transactionTime: stuckDay.start + 3_600_000 });
    const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [readableDay, stuckDay] });

    const first = await runOver(state, [stuck]);
    const second = await runOver(state, [stuck]);

    expect(queriesOf(first.deps).map((query) => query.startTime)).toEqual([
      NOW - 2 * DAY_MS,
      stuckDay.start,
      readableDay.start,
      NOW - PAY_WINDOW_MS,
    ]);
    expect(queriesOf(second.deps).at(-1)).toEqual({
      startTime: stuck.transactionTime - 1,
      endTime: stuck.transactionTime + 1,
    });
  });

  // The mark is the pass the window left behind: an absence longer than the window leaves the
  // overlap day of the cursor the pass was started from unread, and not behind the new cursor.
  it('reads the overlap day behind an in-window re-scan mark that an absence of more than the window outran', async () => {
    const firstRunAt = NOW - 100 * DAY_MS;
    const firstCursor = firstRunAt - 2 * DAY_MS;
    const dense = spreadOrders(900, firstRunAt - 88 * DAY_MS, 86 * DAY_MS);
    const late = order({ transactionId: 'late', transactionTime: firstCursor - 0.5 * DAY_MS });
    const state = stateOf({ payCursor: firstCursor });

    await runOver(state, [...dense, late], firstRunAt);

    expect(state.imported.has(keyOf(state, late))).toBe(false);
    expect(state.rescanCursor).not.toBeNull();

    await runOver(state, [...dense, late]);

    expect(state.imported.has(keyOf(state, late))).toBe(true);
  });

  it('empties the list and walks from the floor after a disconnect reset the walk', async () => {
    const owed = { start: NOW - 300 * DAY_MS, end: NOW - 299 * DAY_MS };
    const reset = withWalkOwnedMetadataResetToFloor(
      {
        binanceAsset: 'BTC',
        binancePayHistoryCursor: NOW,
        binancePayRescanCursor: NOW - DAY_MS,
        binancePayPendingOverlap: [owed],
      },
      HISTORY_FLOOR_MS,
    );
    const state = stateOf({
      payCursor: HISTORY_FLOOR_MS,
      rescanCursor: HISTORY_FLOOR_MS,
      pending: binanceWalkPendingOf('binancePayPendingOverlap', reset),
    });

    const { deps } = await runOver(state, []);

    expect(reset?.binancePayPendingOverlap).toEqual([]);
    expect(queriesOf(deps)[0].startTime).toBe(payFloorMs(NOW));
    expect(queriesOf(deps).every((query) => query.startTime >= payFloorMs(NOW))).toBe(true);
    expect(state.pending).toEqual([]);
  });

  it('drops an owed day the floor has passed, cuts one it crosses, and reads the rest', async () => {
    const floor = payFloorMs(NOW);
    const passed = { start: floor - 3 * DAY_MS, end: floor - 2 * DAY_MS };
    const crossed = { start: floor - 0.5 * DAY_MS, end: floor + 0.5 * DAY_MS };
    const beyond = { start: floor + 10 * DAY_MS, end: floor + 11 * DAY_MS };
    const crossedOrder = order({ transactionId: 'crossed', transactionTime: floor + 1_000 });
    const beyondOrder = order({ transactionId: 'beyond', transactionTime: beyond.start + 1_000 });
    const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [passed, crossed, beyond] });

    const { deps } = await runOver(state, [crossedOrder, beyondOrder]);

    expect(queriesOf(deps).every((query) => query.startTime >= floor)).toBe(true);
    expect(queriesOf(deps).some((query) => query.startTime === floor)).toBe(true);
    expect(state.imported.has(keyOf(state, crossedOrder))).toBe(true);
    expect(state.imported.has(keyOf(state, beyondOrder))).toBe(true);
    expect(state.pending).toEqual([]);
  });

  it('keeps a stopped day while the floor has not passed it', async () => {
    const floor = payFloorMs(NOW);
    const stuckDay = { start: floor + DAY_MS, end: floor + 2 * DAY_MS };
    const stuck = order({ transactionId: '', transactionTime: stuckDay.start + 1_000 });
    const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });

    await runOver(state, [stuck]);

    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].start).toBeGreaterThanOrEqual(stuckDay.start);
    expect(state.pending[0].end).toBeLessThanOrEqual(stuckDay.end);
    expect(state.pending[0].start).toBeLessThanOrEqual(stuck.transactionTime);
    expect(state.pending[0].end).toBeGreaterThanOrEqual(stuck.transactionTime);
  });

  it('imports nothing on a second identical run once every owed day has been read', async () => {
    const cursor = NOW - 120 * DAY_MS;
    const late = order({ transactionId: 'late', transactionTime: cursor - 0.5 * DAY_MS });
    const newer = order({ transactionId: 'newer', transactionTime: cursor + 3_600_000 });
    const state = stateOf({ payCursor: cursor });
    await runUntilComplete(state, () => [late, newer]);

    const again = await runOver(state, [late, newer]);

    expect(state.imported.size).toBe(2);
    expect(again.result).toEqual({ imported: 0, complete: true });
    expect(state.pending).toEqual([]);
  });

  describe('with a stored list that cannot be read', () => {
    const CURSOR = NOW - 3_600_000;
    const unreadable = () =>
      stateOf({
        payCursor: CURSOR,
        pending: 'not a list' as unknown as WalkWindow[],
      });

    it('logs one fixed code and does not fail the walk', async () => {
      const state = unreadable();

      await runOver(state, []);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[binance sync] pending overlap ranges unreadable', {
        name: 'BinanceWalkStop',
        code: 'pending-malformed',
      });
    });

    it('owes all the ground from the floor to the cursor, stored before anything is read', async () => {
      const state = unreadable();

      const { deps } = await runOver(state, []);

      expect((deps.writeWalkPending as jest.Mock).mock.calls[0]).toEqual([
        'h-spot',
        'binancePayPendingOverlap',
        [{ start: payFloorMs(NOW), end: CURSOR }],
      ]);
    });

    it('imports an owed record older than the window, then owes nothing', async () => {
      const old = order({ transactionId: 'old', transactionTime: NOW - 300 * DAY_MS });
      const state = unreadable();

      const runs = await runUntilComplete(state, () => [old]);

      expect(runs.at(-1)).toBe(true);
      expect(state.imported.has(keyOf(state, old))).toBe(true);
      expect(state.pending).toEqual([]);
    });
  });

  describe('with a range that has a stuck record in it', () => {
    const BASE = NOW - 300 * DAY_MS;
    const stuckDay = { start: BASE, end: BASE + DAY_MS };
    const stuckAt = stuckDay.start + 3_600_000;
    const stuckOrder = () => order({ transactionId: '', transactionTime: stuckAt });
    const fixedOrder = () => order({ transactionId: 'fixed', transactionTime: stuckAt });
    const pointAt = (time: number): OwedGround => ({
      start: time - 1,
      end: time + 1,
      kind: 'point',
    });
    // The overlap day behind the cursor lies in the window the re-scan reads; only the ground
    // older than that window is the pending pass's.
    const beyondWindow = (ranges: WalkWindow[]): WalkWindow[] =>
      ranges.filter((range) => range.end <= NOW - PAY_WINDOW_MS);

    it('imports an unrelated owed day that a merge past the twelve-range cap put beside the stuck range, and keeps only the stuck order owed at its point', async () => {
      const unrelatedDay = { start: BASE + 2.5 * DAY_MS, end: BASE + 3.5 * DAY_MS };
      const unrelated = order({ transactionId: 'unrelated', transactionTime: unrelatedDay.start });
      const others = Array.from({ length: 11 }, (_unused, index) => ({
        start: BASE - (10 + index * 10) * DAY_MS,
        end: BASE - (9 + index * 10) * DAY_MS,
      }));
      const state = stateOf({
        payCursor: NOW - 2 * DAY_MS,
        pending: [...others, stuckDay, unrelatedDay],
      });

      await runOver(state, [stuckOrder(), unrelated]);

      expect(state.imported.has(keyOf(state, unrelated))).toBe(true);
      expect(state.imported.size).toBe(1);
      expect(beyondWindow(state.pending)).toEqual([pointAt(stuckAt)]);
    });

    it('imports a good order in the same millisecond as the stuck one, and keeps only the stuck one owed', async () => {
      const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });

      await runOver(state, [stuckOrder(), fixedOrder()]);

      expect(state.imported).toEqual(new Set([keyOf(state, fixedOrder())]));
      expect(beyondWindow(state.pending)).toEqual([pointAt(stuckAt)]);
    });

    it('writes the rows of a read before the list that owes its stuck order', async () => {
      const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });

      const { deps } = await runOver(state, [stuckOrder(), fixedOrder()]);

      const adds = deps.addTransactions as jest.Mock;
      const listWrites = deps.writeWalkPending as jest.Mock;
      const addedAt = adds.mock.invocationCallOrder[0];
      const owedAt = listWrites.mock.calls.findIndex((call) =>
        (call[2] as WalkWindow[]).some((range) => range.start === stuckAt - 1),
      );
      expect(addedAt).toBeLessThan(listWrites.mock.invocationCallOrder[owedAt]);
    });

    it('re-scans the orders after a stuck one in the same run, and owes the stuck order at its point', async () => {
      const stuckInWindow = order({ transactionId: '', transactionTime: NOW - 10 * DAY_MS });
      const later = order({ transactionId: 'later', transactionTime: NOW - 5 * DAY_MS });
      const earlier = order({ transactionId: 'earlier', transactionTime: NOW - 20 * DAY_MS });
      const state = stateOf({ payCursor: NOW - 2 * DAY_MS });

      const { result } = await runOver(state, [earlier, stuckInWindow, later]);

      expect(state.imported).toEqual(new Set([keyOf(state, earlier), keyOf(state, later)]));
      expect(state.pending).toEqual([pointAt(stuckInWindow.transactionTime)]);
      expect(result.complete).toBe(false);
    });

    describe('with an order of another coin that the user paid with BTC funds', () => {
      const PAID_AT = stuckAt;
      const funded = { payerId: OWN, receiverId: OTHER, transactionTime: PAID_AT };
      const serverWith = (orders: BinancePayOrder[], fundedOrders: unknown[]) =>
        jest.fn(async (_apiKey: string, _secret: string, query: PayQuery) =>
          payPage(
            orders.filter(
              (candidate) =>
                candidate.transactionTime >= query.startTime &&
                candidate.transactionTime <= query.endTime,
            ),
            {
              btcFundedOtherCoinOrders: fundedOrders.filter(
                (entry) =>
                  (entry as typeof funded).transactionTime >= query.startTime &&
                  (entry as typeof funded).transactionTime <= query.endTime,
              ) as PayHistoryPage['btcFundedOtherCoinOrders'],
            },
          ),
        );

      it('imports the other orders of the owed day and keeps only that order owed, at its point', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });
        const beside = order({ transactionId: 'beside', transactionTime: stuckAt + 10 });

        const { result } = await runOver(state, [], NOW, {
          fetchPayHistory: serverWith([beside], [funded]),
        });

        expect(state.imported).toEqual(new Set([keyOf(state, beside)]));
        expect(beyondWindow(state.pending)).toEqual([pointAt(PAID_AT)]);
        expect(result.complete).toBe(false);
        expect(warn.mock.calls).toEqual([
          [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-btc-funded-other-coin' }],
        ]);
      });

      it('owes the whole day when the order carries no time', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });
        const timeless = { ...funded, transactionTime: undefined };
        const beside = order({ transactionId: 'beside', transactionTime: stuckAt + 10 });
        const inOwedDay = jest.fn(async (_apiKey: string, _secret: string, query: PayQuery) =>
          query.startTime < NOW - PAY_WINDOW_MS
            ? payPage([beside], { btcFundedOtherCoinOrders: [timeless] })
            : payPage([]),
        );

        await runOver(state, [], NOW, { fetchPayHistory: inOwedDay });

        expect(state.imported).toEqual(new Set([keyOf(state, beside)]));
        expect(beyondWindow(state.pending)).toEqual([stuckDay]);
      });

      it('owes the whole day when the order carries a time outside the day it was read in', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });
        const outside = { ...funded, transactionTime: stuckDay.end + 5 * DAY_MS };
        const beside = order({ transactionId: 'beside', transactionTime: stuckAt + 10 });
        const inOwedDay = jest.fn(async (_apiKey: string, _secret: string, query: PayQuery) =>
          query.startTime < NOW - PAY_WINDOW_MS
            ? payPage([beside], { btcFundedOtherCoinOrders: [outside] })
            : payPage([]),
        );

        await runOver(state, [], NOW, { fetchPayHistory: inOwedDay });

        expect(state.imported).toEqual(new Set([keyOf(state, beside)]));
        expect(beyondWindow(state.pending)).toEqual([stuckDay]);
      });

      it('owes the order at its point in the window re-scan too, and the other orders still import', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS });
        const paidAt = NOW - 10 * DAY_MS;
        const beside = order({ transactionId: 'beside', transactionTime: paidAt + 10 });
        const after = order({ transactionId: 'after', transactionTime: NOW - 5 * DAY_MS });

        const { result } = await runOver(state, [], NOW, {
          fetchPayHistory: serverWith([beside, after], [{ ...funded, transactionTime: paidAt }]),
        });

        expect(state.imported).toEqual(new Set([keyOf(state, beside), keyOf(state, after)]));
        expect(state.pending).toEqual([pointAt(paidAt)]);
        expect(result.complete).toBe(false);
        expect(warn.mock.calls).toEqual([
          [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-btc-funded-other-coin' }],
        ]);
      });

      it('still stops the forward pass, cursor unmoved, and imports nothing of that window', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS });
        const beside = order({ transactionId: 'beside', transactionTime: NOW - DAY_MS });
        const paid = { ...funded, transactionTime: NOW - DAY_MS + 5 };

        const { result } = await runOver(state, [], NOW, {
          fetchPayHistory: serverWith([beside], [paid]),
        });

        expect(result).toEqual({ imported: 0, complete: false });
        expect(state.imported.size).toBe(0);
        expect(state.payCursor).toBe(NOW - 2 * DAY_MS);
      });
    });

    it('reads a new owed range on the first run, behind eleven stuck ranges that are older', async () => {
      const stuckRanges = Array.from({ length: 11 }, (_unused, index) => ({
        start: BASE + index * 10 * DAY_MS,
        end: BASE + index * 10 * DAY_MS + DAY_MS,
      }));
      const newDay = { start: BASE + 150 * DAY_MS, end: BASE + 151 * DAY_MS };
      const stuckOrders = stuckRanges.map((range, index) =>
        order({ transactionId: '', transactionTime: range.start + 1_000 + index }),
      );
      const fresh = order({ transactionId: 'new-day', transactionTime: newDay.start + 1_000 });
      const state = stateOf({
        payCursor: NOW - 2 * DAY_MS,
        pending: [...stuckRanges, newDay],
      });

      await runOver(state, [...stuckOrders, fresh]);

      expect(state.imported.has(keyOf(state, fresh))).toBe(true);
    });

    describe('with ten owed points, one for each of ten stuck days', () => {
      const stuckDays = Array.from({ length: 10 }, (_unused, index) => ({
        start: BASE + index * 10 * DAY_MS,
        end: BASE + index * 10 * DAY_MS + DAY_MS,
      }));
      const stuckTimes = stuckDays.map((day, index) => day.start + 3_600_000 + index);
      const stuckOrders = () =>
        stuckTimes.map((transactionTime) => order({ transactionId: '', transactionTime }));
      const fixedOrders = () =>
        stuckTimes.map((transactionTime, index) =>
          order({ transactionId: `fixed-${index}`, transactionTime }),
        );
      const newDay = { start: BASE + 150 * DAY_MS, end: BASE + 151 * DAY_MS };
      const fresh = () =>
        order({ transactionId: 'new-day', transactionTime: newDay.start + 1_000 });
      const late = () => order({ transactionId: 'late', transactionTime: NOW - 50 * DAY_MS });
      const isolatedOwed = (state: PendingState): WalkWindow[] =>
        beyondWindow(state.pending).filter((range) => range.end - range.start <= 2);
      const isolatedSpans = stuckTimes.map(pointAt);

      const stateWithIsolated = () =>
        stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [...isolatedSpans, newDay] });

      it('owes each stuck day at its order alone after one run over the days', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: stuckDays });

        await runOver(state, [...stuckOrders(), ...fixedOrders()]);

        expect(beyondWindow(state.pending)).toEqual(isolatedSpans);
        expect(state.imported.size).toBe(10);
      });

      it('imports the new owed day and the late order of the window on the next run, and keeps the spans owed', async () => {
        const state = stateWithIsolated();

        await runOver(state, [...stuckOrders(), fresh(), late()]);

        expect(state.imported.has(keyOf(state, fresh()))).toBe(true);
        expect(state.imported.has(keyOf(state, late()))).toBe(true);
        expect(state.imported.size).toBe(2);
        expect(isolatedOwed(state)).toHaveLength(10);
        expect(state.pending.some((range) => range.start === newDay.start)).toBe(false);
      });

      it('reads the new owed day and the re-scan before any of the spans, in one run', async () => {
        const state = stateWithIsolated();

        const { deps } = await runOver(state, [...stuckOrders(), fresh(), late()]);

        const starts = queriesOf(deps).map((query) => query.startTime);
        expect(starts.indexOf(newDay.start)).toBeGreaterThan(0);
        expect(starts.indexOf(newDay.start)).toBeLessThan(starts.indexOf(isolatedSpans[0].start));
        expect(starts.indexOf(NOW - PAY_WINDOW_MS)).toBeLessThan(
          starts.indexOf(isolatedSpans[0].start),
        );
      });

      it('imports a span that became readable on a later run once budget is left, and nothing twice', async () => {
        const state = stateWithIsolated();
        await runOver(state, [...stuckOrders(), fresh(), late()]);

        for (let attempt = 0; attempt < 10; attempt += 1) {
          await runOver(state, [...fixedOrders(), fresh(), late()]);
        }

        expect(state.imported.size).toBe(12);
        expect(beyondWindow(state.pending)).toEqual([]);

        const again = await runOver(state, [...fixedOrders(), fresh(), late()]);

        expect(again.result).toEqual({ imported: 0, complete: true });
      });

      it('imports nothing on a second run over the same stuck orders', async () => {
        const state = stateWithIsolated();
        await runOver(state, [...stuckOrders(), fresh(), late()]);

        const second = await runOver(state, [...stuckOrders(), fresh(), late()]);

        expect(second.result).toEqual({ imported: 0, complete: false });
        expect(state.imported.size).toBe(2);
        expect(isolatedOwed(state)).toHaveLength(10);
      });
    });

    it('owes the stuck range at its order alone after the first run, and reads only that point from then on', async () => {
      const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });

      await runOver(state, [stuckOrder()]);
      const owedAfterFirst = beyondWindow(state.pending);

      const second = await runOver(state, [stuckOrder()]);

      expect(owedAfterFirst).toEqual([pointAt(stuckAt)]);
      expect(beyondWindow(state.pending)).toEqual(owedAfterFirst);
      expect(
        queriesOf(second.deps).filter((query) => query.startTime < NOW - PAY_WINDOW_MS),
      ).toEqual([{ startTime: stuckAt - 1, endTime: stuckAt + 1 }]);
    });

    it('imports the stuck record once it can be placed, and a later identical run imports nothing', async () => {
      const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });

      for (let attempt = 0; attempt < 30; attempt += 1) {
        await runOver(state, [stuckOrder()]);
      }

      expect(state.imported.size).toBe(0);

      const fixed = await runOver(state, [fixedOrder()]);
      const again = await runOver(state, [fixedOrder()]);

      expect(fixed.result.imported).toBe(1);
      expect(state.imported.has(keyOf(state, fixedOrder()))).toBe(true);
      expect(state.pending).toEqual([]);
      expect(again.result).toEqual({ imported: 0, complete: true });
    });

    describe('while the forward pass stops at an order it cannot trust, in every run', () => {
      const CURSOR = NOW - 2 * DAY_MS;
      const forwardStuck = () => order({ transactionId: '', transactionTime: NOW - 3_600_000 });
      const repaired = () => order({ transactionId: 'repaired', transactionTime: stuckAt });

      it('goes on to the owed day and the window re-scan, and the cursor stays', async () => {
        const state = stateOf({ payCursor: CURSOR, pending: [stuckDay] });

        const { deps, result } = await runOver(state, [forwardStuck(), stuckOrder(), fixedOrder()]);

        expect(state.imported).toEqual(new Set([keyOf(state, fixedOrder())]));
        expect(state.payCursor).toBe(CURSOR);
        expect(queriesOf(deps).some((query) => query.startTime === NOW - PAY_WINDOW_MS)).toBe(true);
        expect(beyondWindow(state.pending)).toEqual([pointAt(stuckAt)]);
        expect(result.complete).toBe(false);
      });

      it('reads the points in the next run: a record that settles meanwhile imports, and the cursor stays', async () => {
        const state = stateOf({ payCursor: CURSOR, pending: [stuckDay] });
        await runOver(state, [forwardStuck(), stuckOrder()]);

        const second = await runOver(state, [forwardStuck(), repaired()]);

        expect(state.imported).toEqual(new Set([keyOf(state, repaired())]));
        expect(queriesOf(second.deps)).toContainEqual({
          startTime: stuckAt - 1,
          endTime: stuckAt + 1,
        });
        expect(
          queriesOf(second.deps).some((query) => query.startTime === NOW - PAY_WINDOW_MS),
        ).toBe(true);
        expect(beyondWindow(state.pending)).toEqual([]);
        expect(state.payCursor).toBe(CURSOR);
      });
    });

    describe('with an item the client could not read', () => {
      const UNREADABLE_CODE = 'pay-row-unreadable';
      const goodOrder = () => order({ transactionId: 'good', transactionTime: stuckAt });

      /** A read that also reports the unreadable items in the span (all those with no time). */
      const reporting = (serve: ReturnType<typeof serverOf>, unreadable: UnreadableRow[]) =>
        jest.fn(async (apiKey: string, secret: string, query: PayQuery) => {
          const page = await serve(apiKey, secret, query);
          const inSpan = unreadable.filter(
            ({ time }) =>
              typeof time !== 'number' || (time >= query.startTime && time <= query.endTime),
          );

          return { ...page, unreadable: inSpan, gathered: page.gathered + inSpan.length };
        });

      const loggedCodes = (): string[] => warn.mock.calls.map(([, detail]) => detail.code);

      it('imports the readable order of an owed day and owes the unreadable one at its own point, logging only the code', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });

        const { result } = await runOver(state, [], NOW, {
          fetchPayHistory: reporting(serverOf([goodOrder()], ASCENDING), [{ time: stuckAt }]),
        });

        expect(state.imported).toEqual(new Set([keyOf(state, goodOrder())]));
        expect(beyondWindow(state.pending)).toEqual([pointAt(stuckAt)]);
        expect(warn.mock.calls).toEqual([
          [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: UNREADABLE_CODE }],
        ]);
        expect(result.complete).toBe(false);
      });

      it('owes the whole span of an item with no usable time, and imports the other orders of it', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });

        await runOver(state, [], NOW, {
          fetchPayHistory: reporting(serverOf([goodOrder()], ASCENDING), [{ time: undefined }]),
        });

        expect(state.imported).toEqual(new Set([keyOf(state, goodOrder())]));
        expect(beyondWindow(state.pending)).toEqual([stuckDay]);
        expect(loggedCodes()).toContain(UNREADABLE_CODE);
      });

      it('owes the point of an unreadable item of the re-scan window, and imports the orders around it', async () => {
        const unreadableAt = NOW - 10 * DAY_MS;
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS });
        const later = order({ transactionId: 'later', transactionTime: NOW - 5 * DAY_MS });

        const { result } = await runOver(state, [], NOW, {
          fetchPayHistory: reporting(serverOf([later], ASCENDING), [{ time: unreadableAt }]),
        });

        expect(state.imported).toEqual(new Set([keyOf(state, later)]));
        expect(state.pending).toEqual([pointAt(unreadableAt)]);
        expect(result.complete).toBe(false);
      });

      it('stops the forward pass like any other stop: the cursor stays, and the owed day is still read', async () => {
        const cursor = NOW - 2 * DAY_MS;
        const state = stateOf({ payCursor: cursor, pending: [stuckDay] });

        const { result } = await runOver(state, [], NOW, {
          fetchPayHistory: reporting(serverOf([goodOrder()], ASCENDING), [
            { time: NOW - 3_600_000 },
          ]),
        });

        expect(state.payCursor).toBe(cursor);
        expect(state.imported).toEqual(new Set([keyOf(state, goodOrder())]));
        expect(result.complete).toBe(false);
      });

      it('never rejects the run for an item, and writes the rows of the span before the list that owes it', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [stuckDay] });

        const { deps } = await runOver(state, [], NOW, {
          fetchPayHistory: reporting(serverOf([goodOrder()], ASCENDING), [{ time: stuckAt }]),
        });

        const listWrites = deps.writeWalkPending as jest.Mock;
        const owedAt = listWrites.mock.calls.findIndex((call) =>
          (call[2] as WalkWindow[]).some((range) => range.start === stuckAt - 1),
        );
        expect((deps.addTransactions as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
          listWrites.mock.invocationCallOrder[owedAt],
        );
      });
    });

    describe('a point whose window comes back full, so it is read in halves', () => {
      const repaired = () => order({ transactionId: 'repaired', transactionTime: stuckAt });
      const secondHalfOf = (query: PayQuery): boolean =>
        query.startTime === stuckAt && query.endTime === stuckAt + 1;
      const rateLimited = (): PayHistoryPage => {
        throw new BinanceRateLimitError(429, 60_000);
      };

      /** The point's window is full; each half answers with the orders given, or a rate limit. */
      const halvesGiving = (first: BinancePayOrder[], second: BinancePayOrder[] | 'rate limit') => {
        const answers = new Map<string, () => PayHistoryPage>([
          [`${stuckAt - 1}:${stuckAt + 1}`, () => fullPage()],
          [`${stuckAt - 1}:${stuckAt}`, () => payPage(first)],
          [
            `${stuckAt}:${stuckAt + 1}`,
            second === 'rate limit' ? rateLimited : () => payPage(second),
          ],
        ]);

        return jest.fn(
          async (_apiKey: string, _secret: string, query: PayQuery) =>
            answers.get(`${query.startTime}:${query.endTime}`)?.() ?? payPage([]),
        );
      };

      it('takes the point off the list once both halves were read, though only the second held its record', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [pointAt(stuckAt)] });

        const { deps } = await runOver(state, [], NOW, {
          fetchPayHistory: halvesGiving([], [repaired()]),
        });

        expect(state.imported).toEqual(new Set([keyOf(state, repaired())]));
        expect(queriesOf(deps).filter(secondHalfOf)).toHaveLength(1);
        expect(beyondWindow(state.pending)).toEqual([]);
      });

      it('keeps the point when the budget ends after the first half, though that half returned its record', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [pointAt(stuckAt)] });

        await runOver(state, [], NOW, {
          fetchPayHistory: halvesGiving([repaired()], 'rate limit'),
        });

        expect(state.imported).toEqual(new Set([keyOf(state, repaired())]));
        expect(beyondWindow(state.pending)).toEqual([pointAt(stuckAt)]);
      });

      it('keeps the point when its record is stuck in the second half, whatever the first half returned', async () => {
        const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [pointAt(stuckAt)] });

        await runOver(state, [], NOW, {
          fetchPayHistory: halvesGiving([repaired()], [stuckOrder()]),
        });

        expect(beyondWindow(state.pending)).toEqual([pointAt(stuckAt)]);
      });
    });

    describe('the point cursor of the round-robin', () => {
      const CURSOR = NOW - 2 * DAY_MS;
      const times = [
        BASE + 3_600_000,
        BASE + 10 * DAY_MS + 3_600_000,
        BASE + 20 * DAY_MS + 3_600_000,
      ];
      const points = times.map(pointAt);
      const stuckAtEach = () =>
        times.map((time) => order({ transactionId: '', transactionTime: time }));
      const pointQueryStarts = (deps: BinancePayHistoryDeps) =>
        queriesOf(deps)
          .filter((query) => points.some((point) => point.start === query.startTime))
          .map((query) => query.startTime);

      it('stores the start of the point it read, after the list write of that point', async () => {
        const state = stateOf({ payCursor: CURSOR, pending: [stuckDay] });
        await runOver(state, [stuckOrder()]);
        const fixed = order({ transactionId: 'repaired', transactionTime: stuckAt });

        const { deps } = await runOver(state, [fixed]);

        const cursorWrites = deps.writeWalkCursor as jest.Mock;
        const pointWriteAt = cursorWrites.mock.calls.findIndex((call) => call[1] === POINT_FIELD);
        const lastListWrite = Math.max(
          ...(deps.writeWalkPending as jest.Mock).mock.invocationCallOrder,
        );
        expect(cursorWrites.mock.calls[pointWriteAt][2]).toBe(stuckAt - 1);
        expect(cursorWrites.mock.invocationCallOrder[pointWriteAt]).toBeGreaterThan(lastListWrite);
        expect(state.pointCursor).toBe(stuckAt - 1);
      });

      it('reads the points after the stored cursor first, then wraps around to the ones before', async () => {
        const state = stateOf({
          payCursor: CURSOR,
          pending: points,
          pointCursor: points[0].start,
        });

        const { deps } = await runOver(state, stuckAtEach());

        expect(pointQueryStarts(deps)).toEqual([points[1].start, points[2].start, points[0].start]);
        expect(state.pointCursor).toBe(points[0].start);
      });

      it('starts at the oldest point, with one fixed log code, when the stored cursor is no number', async () => {
        const deps = makeDeps({
          listHoldings: async () => [
            holdingWith('h-spot', {
              binanceAsset: 'BTC',
              binancePayHistoryCursor: CURSOR,
              binancePayPendingOverlap: points,
              binancePayPointCursor: 'soon',
            }),
          ],
          fetchPayHistory: serverOf(stuckAtEach(), ASCENDING),
        });

        await sync(deps);

        expect(pointQueryStarts(deps)).toEqual(points.map((point) => point.start));
        expect(warn.mock.calls).toContainEqual([
          '[binance sync] point cursor unreadable',
          { name: 'BinanceWalkStop', code: 'point-cursor-malformed' },
        ]);
      });

      it('repairs a stored cursor that is no number on the first run, which logs it once: the next run logs nothing', async () => {
        const state = stateOf({
          payCursor: CURSOR,
          pending: points,
          pointCursor: 'soon' as unknown as number,
        });

        const first = await runOver(state, stuckAtEach());
        const written = (first.deps.writeWalkCursor as jest.Mock).mock.calls
          .filter((call) => call[1] === POINT_FIELD)
          .map((call) => call[2]);
        await runOver(state, stuckAtEach());

        expect(written[0]).toBe(Number.MIN_SAFE_INTEGER);
        expect(typeof state.pointCursor).toBe('number');
        expect(
          warn.mock.calls.filter(([tag]) => tag === '[binance sync] point cursor unreadable'),
        ).toHaveLength(1);
      });
    });
  });

  it('asks for nothing more after a rate limit hit in an owed day', async () => {
    const owed = { start: NOW - 300 * DAY_MS, end: NOW - 299 * DAY_MS };
    const another = { start: NOW - 200 * DAY_MS, end: NOW - 199 * DAY_MS };
    const state = stateOf({ payCursor: NOW - 2 * DAY_MS, pending: [owed, another] });
    const fetchPayHistory = jest
      .fn()
      .mockResolvedValueOnce(payPage([]))
      .mockRejectedValue(new BinanceRateLimitError(429, 60_000));

    const { result } = await runOver(state, [], NOW, { fetchPayHistory });

    expect(result.complete).toBe(false);
    expect(fetchPayHistory).toHaveBeenCalledTimes(2);
    expect(state.pending).toEqual([
      owed,
      another,
      { start: NOW - 3 * DAY_MS, end: NOW - 2 * DAY_MS },
    ]);
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
      listHoldings: async () => [spotAt(NOW - 3_600_000)],
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
      listHoldings: async () => [spotAt(NOW - 3_600_000)],
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

  it('stops the window, cursor unmoved, when the uid read fails for any other reason', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW - 3_600_000)],
      fetchAccount: jest.fn(async () => {
        throw new Error('SECRET-BODY');
      }),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchPayHistory).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-uid-unavailable' }],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-BODY');
  });

  it('stops the window, cursor unmoved, when the account has no uid, even with no order in it', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW - 3_600_000)],
      fetchAccount: jest.fn(async () => ({ balances: [], uid: null })),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchPayHistory).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-uid-unavailable' }],
    ]);
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

    await expect(sync(deps, accountId)).rejects.toThrow('Binance request failed: 403');
    expect(isBinanceCoolingDown(accountId, NOW)).toBe(false);
  });
});

describe('an order the walk cannot trust stops its window', () => {
  const recent = { listHoldings: async () => [spotAt(NOW - 3_600_000)] };

  const readsOf = (...orders: BinancePayOrder[]): Partial<BinancePayHistoryDeps> => ({
    ...recent,
    fetchPayHistory: forwardPageOf(NOW - 3_600_000, payPage(orders)),
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

        return payPage(calls === 2 ? [order({ walletType: 4, fundsDetail: costOn(4) })] : []);
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
  const recent = { listHoldings: async () => [spotAt(NOW - 3_600_000)] };
  const PAID_AT = NOW - 1_800_000;
  const sentByUser = { payerId: OWN, receiverId: OTHER, transactionTime: PAID_AT };
  const receivedByUser = { payerId: OTHER, receiverId: OWN, transactionTime: PAID_AT };

  it('stops the window, cursor unmoved, on a non-BTC order the user paid with BTC funds', async () => {
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: forwardPageOf(
        NOW - 3_600_000,
        payPage([order()], { btcFundedOtherCoinOrders: [sentByUser] }),
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

  it('ignores a non-BTC order the user received though the payer paid with BTC funds', async () => {
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () =>
        payPage([order()], { btcFundedOtherCoinOrders: [receivedByUser] }),
      ),
    });

    const result = await sync(deps);

    expect(result.complete).toBe(true);
    expect(deps.addTransactions).toHaveBeenCalled();
    expect(cursorWritesOf(deps)).toEqual([NOW]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['no party is the user', { payerId: '7', receiverId: '8' }],
    ['the parties name no id', { payerId: undefined, receiverId: undefined }],
    ['the user is both parties', { payerId: OWN, receiverId: OWN }],
  ])('stops on a non-BTC order paid with BTC funds when %s', async (_label, parties) => {
    const unsettled = { ...parties, transactionTime: PAID_AT };

    const deps = makeDeps({
      ...recent,
      fetchPayHistory: forwardPageOf(
        NOW - 3_600_000,
        payPage([], { btcFundedOtherCoinOrders: [receivedByUser, unsettled] }),
      ),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-btc-funded-other-coin' }],
    ]);
  });

  it('commits the part of a full window before the order, and stops at the part holding it', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW - PAY_WINDOW_MS)],
      fetchPayHistory: scripted([
        fullPage({ btcFundedOtherCoinOrders: [sentByUser] }),
        payPage([order({ transactionId: 'clean' })]),
        payPage([], { btcFundedOtherCoinOrders: [sentByUser] }),
      ]),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 1, complete: false });
    expect(cursorWritesOf(deps)).toEqual([NOW - PAY_WINDOW_MS + Math.floor(PAY_WINDOW_MS / 2)]);
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-btc-funded-other-coin' }],
    ]);
  });
});

describe('wallet holdings', () => {
  const earnOrder = order({ walletType: 5, fundsDetail: costOn(5) });

  it('creates a missing Earn holding at zero, then places the row on it', async () => {
    let created = false;
    const earn = holdingWith('h-earn', { binanceAsset: 'BTC:earn' });
    const deps = makeDeps({
      listHoldings: async () =>
        created ? [spotAt(NOW - 3_600_000), earn] : [spotAt(NOW - 3_600_000)],
      ensureHoldings: jest.fn(async () => {
        created = true;
      }),
      fetchPayHistory: scripted([payPage([earnOrder])]),
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
      listHoldings: async () => [spotAt(NOW - 3_600_000)],
      fetchPayHistory: forwardPageOf(NOW - 3_600_000, payPage([earnOrder])),
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
      listHoldings: async () => [spotAt(NOW - 3_600_000), funding],
      fetchPayHistory: jest.fn(async () => payPage([split])),
    });

    await sync(deps);

    expect(addedRows(deps).map((row) => [row.holdingId, row.amountMinorUnits])).toEqual([
      ['h-funding', -60_000],
      ['h-spot', -40_000],
    ]);
  });
});

describe('the range cursor and the span hints of the round-robin', () => {
  const CURSOR = NOW - 2 * DAY_MS;
  const dayAt = (index: number): OwedGround => ({
    start: NOW - 150 * DAY_MS + index * 10 * DAY_MS,
    end: NOW - 150 * DAY_MS + index * 10 * DAY_MS + DAY_MS,
  });
  const days = [dayAt(0), dayAt(1), dayAt(2)];
  const RANGE_FIELD = 'binancePayRangeCursor';
  const HINTS_FIELD = 'binancePaySpanHints';
  const metadataOf = (extra: Record<string, unknown> = {}) =>
    holdingWith('h-spot', {
      binanceAsset: 'BTC',
      binancePayHistoryCursor: CURSOR,
      binancePayPendingOverlap: days,
      ...extra,
    });
  const dayStartsOf = (deps: BinancePayHistoryDeps): number[] =>
    queriesOf(deps)
      .map((query) => query.startTime)
      .filter((start) => days.some((day) => day.start === start));
  const depsWith = (
    extra: Record<string, unknown> = {},
    over: Partial<BinancePayHistoryDeps> = {},
  ) => makeDeps({ listHoldings: async () => [metadataOf(extra)], ...over });
  const writesTo = (deps: BinancePayHistoryDeps, field: string) =>
    (deps.writeWalkCursor as jest.Mock).mock.calls
      .filter((call) => call[1] === field)
      .map((call) => call[2] as number);

  it('reads the owed days that start after the stored range cursor first, then wraps around', async () => {
    const deps = depsWith({ [RANGE_FIELD]: days[0].end });

    await sync(deps);

    expect(dayStartsOf(deps)).toEqual([days[1].start, days[2].start, days[0].start]);
  });

  it('stores the end of the window of each day it read, once its read has started', async () => {
    const deps = depsWith();

    await sync(deps);

    expect(writesTo(deps, RANGE_FIELD)).toEqual(days.map((day) => day.end));
  });

  it('starts at the oldest day, with one fixed log code, and stores that start, when the stored cursor is no number', async () => {
    const deps = depsWith({ [RANGE_FIELD]: 'soon' });

    await sync(deps);

    expect(dayStartsOf(deps)).toEqual(days.map((day) => day.start));
    expect(warn.mock.calls).toContainEqual([
      '[binance sync] range cursor unreadable',
      { name: 'BinanceWalkStop', code: 'range-cursor-malformed' },
    ]);
    expect(writesTo(deps, RANGE_FIELD)[0]).toBe(Number.MIN_SAFE_INTEGER);
  });

  it('stores the span a day was left at when its halving chain is cut short, and begins with it in the next run', async () => {
    const day = days[0];
    const dense = () =>
      jest.fn(async (_apiKey: string, _secret: string, query: PayQuery) =>
        query.startTime === day.start && query.endTime - query.startTime > DAY_MS / 4
          ? fullPage()
          : payPage([]),
      );
    const requests = dense();
    const first = depsWith(
      { binancePayPendingOverlap: [day] },
      { fetchPayHistory: requests as unknown as BinancePayHistoryDeps['fetchPayHistory'] },
    );
    // The forward window, then the day (too full), then its half (too full): no request is left
    // for the half of that.
    const run = {
      gate: freshRun().gate,
      budget: { canAfford: () => requests.mock.calls.length < 3, record: () => undefined },
    };

    await sync(first, nextAccountId(), run);

    const stored = (first.writeWalkHints as jest.Mock).mock.calls.at(-1)?.[2];
    expect(stored.pending).toEqual([{ start: day.start, end: day.start + DAY_MS / 4 }]);

    const second = depsWith(
      { binancePayPendingOverlap: [day], [HINTS_FIELD]: stored },
      { fetchPayHistory: dense() as unknown as BinancePayHistoryDeps['fetchPayHistory'] },
    );

    await sync(second);

    expect(queriesOf(second).find((query) => query.startTime === day.start)?.endTime).toBe(
      day.start + DAY_MS / 4,
    );
    expect((second.writeWalkHints as jest.Mock).mock.calls.at(-1)?.[2].pending).toEqual([]);
  });

  it('stores a malformed hint over with none, logging one fixed code, and reads the whole window', async () => {
    const deps = depsWith({ binancePayPendingOverlap: [days[0]], [HINTS_FIELD]: 'soon' });

    await sync(deps);

    expect(warn.mock.calls).toContainEqual([
      '[binance sync] span hints unreadable',
      { name: 'BinanceWalkStop', code: 'span-hints-malformed' },
    ]);
    expect(deps.writeWalkHints).toHaveBeenCalledWith('h-spot', HINTS_FIELD, {
      forward: [],
      pending: [],
      rescan: [],
      point: [],
    });
    expect(queriesOf(deps).find((query) => query.startTime === days[0].start)?.endTime).toBe(
      days[0].end,
    );
  });
});
