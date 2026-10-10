import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';

import {
  type BinancePayHistoryDeps,
  PAY_OVERLAP_GUARD_MS,
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
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';

const NOW = Date.UTC(2026, 9, 10);
const OWN = '1001';
const OTHER = '2002';
const WARN_TAG_STOP = '[binance sync] history window stopped';
const WARN_TAG_NOTICE = '[binance sync] history row left out';

// `cooldownUntilByAccount` is module-level and has no exported reset, so every case
// uses its own account id.
let accountSequence = 0;
const nextAccountId = (): string => {
  accountSequence += 1;

  return `acc-pay-${accountSequence}`;
};

const party = (name: string | undefined, binanceId: string | undefined) => ({ name, binanceId });

const order = (over: Partial<BinancePayOrder> = {}): BinancePayOrder => ({
  orderType: 'C2C',
  transactionId: 'tx-1',
  transactionTime: NOW - 10 * DAY_MS,
  amount: '-0.001',
  currency: 'BTC',
  walletType: 2,
  walletTypes: undefined,
  fundsDetail: [],
  payerInfo: party('Me', OWN),
  receiverInfo: party('Ann', OTHER),
  ...over,
});

const payPage = (rows: BinancePayOrder[], over: Partial<PayHistoryPage> = {}): PayHistoryPage => ({
  rows,
  gathered: rows.length,
  oldestTransactionTime:
    rows.length === 0 ? undefined : Math.min(...rows.map((row) => row.transactionTime)),
  hasBtcFundedOtherCoinOrder: false,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  ...over,
});

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

const addedRows = (deps: BinancePayHistoryDeps, call = 0) =>
  (deps.addTransactions as jest.Mock).mock.calls[call][0] as {
    holdingId: string;
    amountMinorUnits: number;
    externalId: string;
    description: string;
    source: string;
    time: number;
  }[];

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

    const floor = Date.UTC(2025, 3, 11);
    const queries = queriesOf(deps);
    expect(payFloorMs(NOW)).toBe(floor);
    expect(result).toEqual({ imported: 0, complete: true });
    expect(queries).toHaveLength(7);
    expect(queries[0].startTime).toBe(floor);
    expect(queries.at(-1)?.endTime).toBe(NOW);

    for (const [index, query] of queries.entries()) {
      expect(query.startTime).toBe(index === 0 ? floor : queries[index - 1].endTime);
      expect(query.endTime - query.startTime).toBeLessThanOrEqual(PAY_WINDOW_MS);
    }
  });

  it('clamps the floor to the last day of a shorter month', () => {
    expect(payFloorMs(Date.UTC(2026, 7, 31, 13, 5))).toBe(Date.UTC(2025, 2, 1, 13, 5));
    expect(payFloorMs(Date.UTC(2028, 1, 29))).toBe(Date.UTC(2026, 7, 30));
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
    expect(written.map((call) => call[2])).toEqual(queriesOf(deps).map((query) => query.endTime));
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

  it('imports one row for an order that two pages both return', async () => {
    const boundary = order({ transactionTime: NOW - 20 * DAY_MS });
    const pages = [
      payPage([order({ transactionId: 'newer' }), boundary], { gathered: PAY_PAGE_LIMIT }),
      payPage([boundary]),
    ];
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () => pages.shift() ?? payPage([])),
    });

    const result = await sync(deps);

    expect(result.imported).toBe(2);
    expect(addedRows(deps).map((row) => row.externalId.split(':').at(-2))).toEqual([
      'newer',
      'tx-1',
    ]);
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

describe('paging a window', () => {
  const recent = { listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)] };

  it('narrows endTime to the oldest order of a full page and stops at a short one', async () => {
    const oldest = NOW - 30 * DAY_MS;
    const pages = [
      payPage([order({ transactionId: 'a' })], {
        gathered: PAY_PAGE_LIMIT,
        oldestTransactionTime: oldest,
      }),
      payPage([order({ transactionId: 'b', transactionTime: oldest })]),
    ];
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () => pages.shift() ?? payPage([])),
    });

    const result = await sync(deps);

    expect(queriesOf(deps)).toEqual([
      { startTime: NOW - PAY_WINDOW_MS, endTime: NOW },
      { startTime: NOW - PAY_WINDOW_MS, endTime: oldest },
    ]);
    expect(result).toEqual({ imported: 2, complete: true });
  });

  it('counts a full page of other coins as a full page, so their orders cannot end the window early', async () => {
    const oldest = NOW - 30 * DAY_MS;
    const pages = [
      payPage([], { gathered: PAY_PAGE_LIMIT, oldestTransactionTime: oldest }),
      payPage([order()]),
    ];
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () => pages.shift() ?? payPage([])),
    });

    const result = await sync(deps);

    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(2);
    expect(result.imported).toBe(1);
  });

  it.each([
    ['does not go below the endTime it was asked for', NOW],
    ['goes above it', NOW + DAY_MS],
    ['falls before the window start', NOW - PAY_WINDOW_MS - 1],
    ['carries no time', undefined],
  ])('stops the window, and keeps the cursor, when a full page %s', async (_label, oldest) => {
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () =>
        payPage([order()], { gathered: PAY_PAGE_LIMIT, oldestTransactionTime: oldest }),
      ),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(1);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_STOP, { name: 'BinanceWalkStop', code: 'pay-page-stuck' }],
    ]);
  });

  it('accepts a page whose oldest order sits exactly on the window start', async () => {
    const start = NOW - PAY_WINDOW_MS;
    const pages = [
      payPage([order()], { gathered: PAY_PAGE_LIMIT, oldestTransactionTime: start }),
      payPage([]),
    ];
    const deps = makeDeps({
      ...recent,
      fetchPayHistory: jest.fn(async () => pages.shift() ?? payPage([])),
    });

    const result = await sync(deps);

    expect(result.complete).toBe(true);
    expect(queriesOf(deps)[1].endTime).toBe(start);
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
    let oldest = NOW;
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)],
      fetchPayHistory: jest.fn(async () => {
        oldest -= 1_000;

        return payPage([], { gathered: PAY_PAGE_LIMIT, oldestTransactionTime: oldest });
      }),
    });

    const result = await sync(deps);

    expect(LANE_CALL_CAPS.pay).toBe(20);
    expect(deps.fetchAccount).toHaveBeenCalledTimes(1);
    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(19);
    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
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
      [WARN_TAG_NOTICE, { name: 'BinanceWalkStop', code: 'pay-uid-unavailable' }],
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
  it('notes a non-BTC order paid with BTC funds once for the run, and imports nothing for it', async () => {
    const deps = makeDeps({
      fetchPayHistory: jest.fn(async () => payPage([], { hasBtcFundedOtherCoinOrder: true })),
    });

    const result = await sync(deps);

    expect(deps.fetchPayHistory).toHaveBeenCalledTimes(7);
    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_NOTICE, { name: 'BinanceWalkStop', code: 'pay-non-btc-funds' }],
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

describe('the overlap guard against capital rows', () => {
  const MINUTE_MS = 60_000;
  const TIME = NOW - 10 * DAY_MS;

  type CapitalRow = { suffix: string | null; amountMinorUnits: number; time: number };

  const capitalRow = (over: Partial<CapitalRow>): CapitalRow => ({
    suffix: 'deposit:9',
    amountMinorUnits: -100_000,
    time: TIME,
    ...over,
  });

  const runWith = async (capital: CapitalRow[]) => {
    const accountId = nextAccountId();
    const rows = capital.map(({ suffix, ...row }) => ({
      ...row,
      externalId: foldMap(maybe(suffix), (value) => `${accountId}:${value}`) ?? null,
    }));
    const deps = makeDeps({
      listHoldings: async () => [spotAt(NOW, NOW - 3_600_000)],
      fetchPayHistory: jest.fn(async () => payPage([order({ transactionTime: TIME })])),
      listHoldingTransactions: jest.fn(async () => rows),
    });
    const result = await sync(deps, accountId);

    return { deps, result };
  };

  it('skips a Pay row that repeats a capital row of the same size 9 minutes apart, and still commits the window', async () => {
    const { deps, result } = await runWith([capitalRow({ time: TIME + 9 * MINUTE_MS })]);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls).toEqual([
      [WARN_TAG_NOTICE, { name: 'BinanceWalkStop', code: 'pay-overlap-skip' }],
    ]);
  });

  it('skips on the guard edge and keeps a row one millisecond past it', async () => {
    const onEdge = await runWith([capitalRow({ time: TIME - PAY_OVERLAP_GUARD_MS })]);
    const pastEdge = await runWith([capitalRow({ time: TIME - PAY_OVERLAP_GUARD_MS - 1 })]);

    expect(onEdge.deps.addTransactions).not.toHaveBeenCalled();
    expect(pastEdge.deps.addTransactions).toHaveBeenCalledTimes(1);
  });

  it('keeps a Pay row 11 minutes from a capital row', async () => {
    const { deps } = await runWith([capitalRow({ time: TIME + 11 * MINUTE_MS })]);

    expect(addedRows(deps)).toHaveLength(1);
  });

  it('keeps a Pay row whose size or sign differs from the capital row', async () => {
    const otherSize = await runWith([capitalRow({ amountMinorUnits: -100_001 })]);
    const otherSign = await runWith([capitalRow({ amountMinorUnits: 100_000 })]);

    expect(otherSize.deps.addTransactions).toHaveBeenCalledTimes(1);
    expect(otherSign.deps.addTransactions).toHaveBeenCalledTimes(1);
  });

  it('matches a withdrawal as well as a deposit', async () => {
    const { deps } = await runWith([capitalRow({ suffix: 'withdraw:3' })]);

    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('compares only capital rows: another source or a Pay row of the same size is no match', async () => {
    const { deps } = await runWith([
      capitalRow({ suffix: null }),
      capitalRow({ suffix: 'pay:C2C:old:2' }),
    ]);

    expect(addedRows(deps)).toHaveLength(1);
  });

  it('reads the rows of a holding once for the whole run', async () => {
    const deps = makeDeps({
      fetchPayHistory: jest.fn(async () => payPage([order()])),
    });

    await sync(deps);

    expect(deps.listHoldingTransactions).toHaveBeenCalledTimes(1);
  });
});
