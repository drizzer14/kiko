import { DAY_MS } from '@kiko/dates';
import {
  type BinanceSpanHints,
  binanceWalkPendingOf,
  withWalkOwnedMetadataResetToFloor,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';

import {
  type BinanceTransactionRow,
  type BinanceTransactionSyncDeps,
  HISTORY_FLOOR_MS,
  parseWithdrawTime,
  syncBinanceTransactions,
} from './binance.transactions';
import {
  BINANCE_REQUEST_INTERVAL_MS,
  COSTS,
  createBinanceHistoryRun,
  LANE_CALL_CAPS,
  UID_WEIGHT_BUDGET_1M,
} from './binance.history-budget';
import {
  type BinanceDeposit,
  BinanceHistoryParseError,
  type BinanceWithdrawal,
  HISTORY_PAGE_LIMIT,
  type HistoryPage,
  type HistoryWindow,
  type UnreadableRow,
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';
import type { OwedGround, WalkWindow } from './binance.history-walk';

const NOW = 1_704_326_400_000; // 2024-01-04T00:00:00Z
const ACCOUNT_ID = 'acc-1';

// The code reads only `id` and `metadata.binanceAsset` off a holding, so a
// minimal shape cast to HoldingRow is enough for these unit tests.
const spotHolding = { id: 'h-spot', metadata: { binanceAsset: 'BTC' } } as unknown as HoldingRow;
const fundingHolding = {
  id: 'h-funding',
  metadata: { binanceAsset: 'BTC:funding' },
} as unknown as HoldingRow;

const deposit = (over: Partial<BinanceDeposit> = {}): BinanceDeposit => ({
  id: '1',
  amount: '0.5',
  coin: 'BTC',
  txId: 'dep-tx',
  insertTime: NOW - DAY_MS,
  status: 1,
  walletType: undefined,
  ...over,
});

const withdrawal = (over: Partial<BinanceWithdrawal> = {}): BinanceWithdrawal => ({
  id: '9',
  amount: '0.25',
  transactionFee: '0.0001',
  coin: 'BTC',
  txId: 'wd-tx',
  applyTime: '2024-01-03 00:00:00',
  status: 6,
  walletType: undefined,
  ...over,
});

/** A history page with no weight reading in the fixture, unless one is given. */
const historyPage = <Row>(
  rows: Row[],
  usedUidWeight1m?: number,
  usedIpWeight1m?: number,
): HistoryPage<Row> => ({
  rows,
  unreadable: [],
  usedUidWeight1m,
  usedIpWeight1m,
});

// A typed, empty deposit-history mock. The explicit params type `mock.calls[n][2]`
// as the HistoryWindow so the window-walk assertions read it without a cast.
const emptyDepositFetch = () =>
  jest.fn(async (_apiKey: string, _secret: string, _window: HistoryWindow) => historyPage([]));

/**
 * A read that gives `rows` to the forward pass (a span that starts at `cursorMs` or later) and
 * no row to any span behind it, so a stop of the forward pass is the only thing to see.
 */
const forwardRowsAt = <Row>(cursorMs: number, rows: Row[]) =>
  jest.fn(async (_apiKey: string, _secret: string, window: HistoryWindow) =>
    historyPage(window.startTime >= cursorMs ? rows : []),
  );

const makeDeps = (over: Partial<BinanceTransactionSyncDeps> = {}): BinanceTransactionSyncDeps => ({
  now: () => NOW,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  listHoldings: async () => [spotHolding],
  ensureHoldings: jest.fn(async () => undefined),
  storedExternalIds: jest.fn(async () => new Set<string>()),
  latestTransactionTime: async () => undefined,
  addTransactions: jest.fn(async (rows: BinanceTransactionRow[]) => rows.length),
  writeWalkCursor: jest.fn(async () => undefined),
  writeWalkPending: jest.fn(async () => undefined),
  writeWalkHints: jest.fn(async () => undefined),
  fetchDepositHistory: jest.fn(async () => historyPage([])),
  fetchWithdrawHistory: jest.fn(async () => historyPage([])),
  ...over,
});

/** The shared request gate and budget one Binance arm builds, fresh for each run. */
const freshRun = (now: () => number = () => NOW, sleep = async (_milliseconds: number) => {}) =>
  createBinanceHistoryRun({ now, sleep });

const sync = (
  deps: BinanceTransactionSyncDeps,
  targetAccountId = ACCOUNT_ID,
  run = freshRun(deps.now),
) => syncBinanceTransactions({ targetAccountId, run }, deps);

/** The values written to the capital cursor, in order; the re-scan mark is another field. */
const cursorWritesOf = (deps: BinanceTransactionSyncDeps): number[] =>
  (deps.writeWalkCursor as jest.Mock).mock.calls
    .filter((call) => call[1] === 'binanceHistoryCursor')
    .map((call) => call[2] as number);

const addedRows = (deps: BinanceTransactionSyncDeps, call = 0): BinanceTransactionRow[] =>
  (deps.addTransactions as jest.Mock).mock.calls[call][0] as BinanceTransactionRow[];

/** The external id of every row any `addTransactions` call of the run was given. */
const importedKeysOf = (deps: BinanceTransactionSyncDeps): string[] =>
  (deps.addTransactions as jest.Mock).mock.calls.flatMap((call) =>
    (call[0] as BinanceTransactionRow[]).map((row) => row.externalId),
  );

/** A Binance deposit history that answers as it does: the span's records, a page at a time. */
const depositServer = (all: BinanceDeposit[]) =>
  jest.fn(async (_apiKey: string, _secret: string, window: HistoryWindow) => {
    const inRange = all
      .filter(
        (record) => record.insertTime >= window.startTime && record.insertTime <= window.endTime,
      )
      .sort((left, right) => right.insertTime - left.insertTime || left.id.localeCompare(right.id));

    return historyPage(inRange.slice(window.offset, window.offset + HISTORY_PAGE_LIMIT));
  });

/**
 * A stateful Spot holding + `writeWalkCursor` pair for a multi-run test:
 * each run's `listHoldings` reads whatever the LAST run's `writeWalkCursor`
 * wrote, so a resumed run genuinely picks up from where the prior one left off.
 */
const makeStatefulSpotAccount = (): {
  listHoldings: () => Promise<HoldingRow[]>;
  writeWalkCursor: jest.Mock<Promise<void>, [string, string, number]>;
  writeWalkPending: jest.Mock<Promise<void>, [string, string, OwedGround[]]>;
  writeWalkHints: jest.Mock<Promise<void>, [string, string, BinanceSpanHints]>;
  cursor: () => number | null;
  rescanCursor: () => number | null;
  pointCursor: () => number | null;
  rangeCursor: () => number | null;
  hints: () => BinanceSpanHints | undefined;
  pending: () => OwedGround[];
} => {
  const marks: Record<string, number> = {};
  let hints: Record<string, BinanceSpanHints> = {};
  let pending: OwedGround[] = [];

  return {
    listHoldings: async () => [
      {
        id: 'h-spot',
        metadata: {
          binanceAsset: 'BTC',
          ...marks,
          ...hints,
          binanceHistoryPendingOverlap: pending,
        },
      } as unknown as HoldingRow,
    ],
    writeWalkHints: jest.fn(async (_holdingId: string, field: string, next: BinanceSpanHints) => {
      hints = { ...hints, [field]: next };
    }),
    rangeCursor: () => marks.binanceHistoryRangeCursor ?? null,
    hints: () => hints.binanceHistorySpanHints,
    writeWalkCursor: jest.fn(async (_holdingId: string, field: string, cursorMs: number) => {
      marks[field] = cursorMs;
    }),
    writeWalkPending: jest.fn(async (_holdingId: string, _field: string, ranges: OwedGround[]) => {
      pending = ranges;
    }),
    cursor: () => marks.binanceHistoryCursor ?? null,
    rescanCursor: () => marks.binanceHistoryRescanCursor ?? null,
    pointCursor: () => marks.binanceHistoryPointCursor ?? null,
    pending: () => pending,
  };
};

type StatefulSpotAccount = ReturnType<typeof makeStatefulSpotAccount>;

/** Deps for a first sync (no cursor) over a stateful Spot account; reads are empty unless given. */
const makeFirstSyncDeps = (
  account: StatefulSpotAccount,
  over: Partial<BinanceTransactionSyncDeps> = {},
): BinanceTransactionSyncDeps =>
  makeDeps({
    listHoldings: account.listHoldings,
    writeWalkCursor: account.writeWalkCursor,
    writeWalkPending: account.writeWalkPending,
    writeWalkHints: account.writeWalkHints,
    latestTransactionTime: async () => undefined,
    ...over,
  });

/** A full deposit page, the length at which the walk asks for the next page. */
const fullDepositPage = (): BinanceDeposit[] =>
  Array.from({ length: HISTORY_PAGE_LIMIT }, (_unused, index) => deposit({ id: `d${index}` }));

/**
 * A history that holds `rows` only in a span ending at now: the forward pass of a recent
 * cursor reads them, and the re-scan of the overlap day behind that cursor reads none.
 */
const rowsAtNow = <Row>(rows: Row[]) =>
  jest.fn(async (_apiKey: string, _secret: string, window: HistoryWindow) =>
    historyPage(window.endTime === NOW ? rows : []),
  );

/** The end of the first of the three 89-day windows a cursor 200 days back is walked in. */
const FIRST_OF_THREE_WINDOWS_END = NOW - 200 * DAY_MS + 89 * DAY_MS;

describe('parseWithdrawTime', () => {
  it('reads a Binance applyTime string as UTC, not the device local zone', () => {
    // A naive Date.parse('2019-10-12 11:12:02') reads it in the LOCAL zone,
    // shifting the withdrawal by the local offset. It must be pinned to UTC.
    expect(parseWithdrawTime('2019-10-12 11:12:02')).toBe(Date.UTC(2019, 9, 12, 11, 12, 2));
  });

  it('passes an epoch-ms number through unchanged', () => {
    expect(parseWithdrawTime(NOW)).toBe(NOW);
  });
});

describe('syncBinanceTransactions', () => {
  it('maps a settled deposit and withdrawal onto the Spot holding, signed, and imports them', async () => {
    // A recent cursor keeps the walk to a single 89-day window.
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory: rowsAtNow([deposit()]),
      fetchWithdrawHistory: rowsAtNow([withdrawal()]),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 2, complete: true });
    expect(addedRows(deps)).toEqual([
      {
        holdingId: 'h-spot',
        amountMinorUnits: 50_000_000, // +0.5 BTC in satoshis
        time: NOW - DAY_MS,
        source: 'binance',
        // The synced external id is namespaced by the target account id
        // (`${accountId}:deposit:<id>`), so two Binance connections cannot collide
        // on the GLOBAL (source, external_id) index — Binance record ids are only
        // per-account unique.
        externalId: 'acc-1:deposit:1',
        // A stable, non-localized asset ticker so the row's normalized name is
        // non-blank and the category-apply sheet appears (parity with a Monobank
        // merchant row).
        description: 'BTC',
      },
      {
        holdingId: 'h-spot',
        amountMinorUnits: -25_000_000, // -0.25 BTC, fee excluded
        time: Date.UTC(2024, 0, 3, 0, 0, 0),
        source: 'binance',
        externalId: 'acc-1:withdraw:9',
        description: 'BTC',
      },
    ]);
  });

  it('reads the credentials for the TARGET account id (per-account isolation)', async () => {
    const readCredentials = jest.fn(async () => ({ apiKey: 'api-key', secret: 'secret' }));
    const deps = makeDeps({ readCredentials });

    await sync(deps);

    expect(readCredentials).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  it('writes the window cursor through writeWalkCursor on the Spot holding, as the capital cursor', async () => {
    const deps = makeDeps({ latestTransactionTime: async () => NOW - 89 * DAY_MS });

    await sync(deps);

    expect(deps.writeWalkCursor).toHaveBeenCalledWith('h-spot', 'binanceHistoryCursor', NOW);
  });

  it('paces the two endpoint requests in a window through the shared run gate', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    // A recent cursor keeps the forward pass to ONE 89-day window and the re-scan to the
    // overlap day: a deposit request then a withdraw request in each, four requests total.
    const deps = makeDeps({ latestTransactionTime: async () => NOW - 89 * DAY_MS });

    await sync(deps, ACCOUNT_ID, freshRun(deps.now, sleep));

    // The first request fires immediately; each later one waits the pacing interval,
    // so none are fired back-to-back.
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(BINANCE_REQUEST_INTERVAL_MS);
  });

  it('paces EVERY request across a wide first-sync window walk so it stays under the weight limit', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    // A first sync (no cursor) walks from the 2017 floor to now: many 89-day
    // windows, two requests each — the case that otherwise fires ~dozens of
    // requests back-to-back and hits a Binance weight-429.
    const deps = makeDeps({ latestTransactionTime: async () => undefined });

    await sync(deps, ACCOUNT_ID, freshRun(deps.now, sleep));

    const requests =
      (deps.fetchDepositHistory as jest.Mock).mock.calls.length +
      (deps.fetchWithdrawHistory as jest.Mock).mock.calls.length;
    // A real wide walk (more than the single-window case above).
    expect(requests).toBeGreaterThan(2);
    // One gate wait before every request except the very first.
    expect(sleep).toHaveBeenCalledTimes(requests - 1);
    expect(sleep).toHaveBeenCalledWith(BINANCE_REQUEST_INTERVAL_MS);
  });

  it('excludes a non-settled deposit (status !== 1) and withdrawal (status !== 6)', async () => {
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory: jest.fn(async () =>
        historyPage([deposit({ id: '2', status: 0 }), deposit({ id: '3' })]),
      ),
      fetchWithdrawHistory: jest.fn(async () =>
        historyPage([withdrawal({ id: '8', status: 3 }), withdrawal({ id: '7' })]),
      ),
    });

    await sync(deps);

    expect(addedRows(deps).map((row) => row.externalId)).toEqual([
      'acc-1:deposit:3',
      'acc-1:withdraw:7',
    ]);
  });

  it('halves a span whose first page is full instead of paging through it, and imports every record once', async () => {
    const records = Array.from({ length: HISTORY_PAGE_LIMIT + 1 }, (_unused, index) =>
      deposit({ id: `d${index}`, insertTime: NOW - 80 * DAY_MS + index * 60_000 }),
    );
    const fetchDepositHistory = depositServer(records);
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory,
    });

    const result = await sync(deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows[0]).toMatchObject({ startTime: NOW - 89 * DAY_MS, endTime: NOW, offset: 0 });
    expect(windows[1].endTime - windows[1].startTime).toBe(Math.floor((89 * DAY_MS) / 2));
    expect(windows.every((window) => window.offset === 0)).toBe(true);
    // The forward pass spends the run's withdraw calls, so the re-scan waits for a later run.
    expect(deps.fetchWithdrawHistory).toHaveBeenCalledTimes(LANE_CALL_CAPS.capitalWithdraw);
    expect(result.complete).toBe(false);
    expect(new Set(importedKeysOf(deps)).size).toBe(HISTORY_PAGE_LIMIT + 1);
  });

  it('pages a span of one millisecond by offset until a short page, collecting every record', async () => {
    const records = Array.from({ length: HISTORY_PAGE_LIMIT + 500 }, (_unused, index) =>
      deposit({ id: `d${index}`, insertTime: NOW - 2 }),
    );
    const fetchDepositHistory = depositServer(records);
    // A cursor at the start of a 2 ms window, so the forward pass is [NOW - 2, NOW].
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 2,
      fetchDepositHistory,
    });

    await sync(deps);

    // The first four requests are the forward pass; the re-scan behind it follows.
    const forward = fetchDepositHistory.mock.calls.slice(0, 4).map((call) => call[2]);
    expect(forward.map((span) => [span.startTime, span.endTime, span.offset])).toEqual([
      [NOW - 2, NOW, 0],
      [NOW - 2, NOW - 1, 0],
      [NOW - 2, NOW - 1, HISTORY_PAGE_LIMIT],
      [NOW - 1, NOW, 0],
    ]);
    expect(new Set(importedKeysOf(deps)).size).toBe(HISTORY_PAGE_LIMIT + 500);
  });

  it('re-sync from a cursor one window back scans the last 89-day window, then the overlap day behind it', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory,
    });

    await sync(deps);

    expect(fetchDepositHistory.mock.calls.map((call) => call[2])).toEqual([
      { startTime: NOW - 89 * DAY_MS, endTime: NOW, offset: 0 },
      { startTime: NOW - 90 * DAY_MS, endTime: NOW - 89 * DAY_MS, offset: 0 },
    ]);
  });

  it('re-sync from a recent cursor goes forward from the cursor, then re-scans the window behind it', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory,
    });

    const result = await sync(deps);

    expect(fetchDepositHistory.mock.calls.map((call) => call[2])).toEqual([
      { startTime: NOW - 10 * DAY_MS, endTime: NOW, offset: 0 },
      { startTime: NOW - 89 * DAY_MS, endTime: NOW - 10 * DAY_MS, offset: 0 },
    ]);
    expect(result).toEqual({ imported: 0, complete: true });
  });

  it('walks contiguous windows back to a cursor older than one window', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    // A cursor 200 days back: the forward pass starts at it and spans three 89-day
    // windows (89 + 89 + 22), and the overlap day behind it is the re-scan.
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 200 * DAY_MS,
      fetchDepositHistory,
    });

    await sync(deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows).toHaveLength(4);
    expect(windows[0].startTime).toBe(NOW - 200 * DAY_MS);
    expect(windows[2].endTime).toBe(NOW);
    expect(windows[3]).toEqual({
      startTime: NOW - 201 * DAY_MS,
      endTime: NOW - 200 * DAY_MS,
      offset: 0,
    });
  });

  it('first sync (no cursor) starts walking from the history floor', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      latestTransactionTime: async () => undefined,
      fetchDepositHistory,
    });

    const result = await sync(deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows[0].startTime).toBe(HISTORY_FLOOR_MS);
    // The withdraw-call budget stops a single run short of `now` — the
    // "resumable, budgeted walk" tests below cover the multi-run completion.
    expect(result.complete).toBe(false);
  });

  it('the watermark wins over a much older legacy latest — the headline "cursor beats latest" rule', async () => {
    // A holding whose watermark is nearly caught up (2 hours behind now), but
    // whose legacy `latestTransactionTime` (a pre-watermark imported row) is
    // stuck in 2019. The start must be fed the WATERMARK, never the stale
    // `latest` — swapping `cursor ?? latest` for `latest ?? cursor` would walk
    // from 2019 instead and fail this test.
    const fetchDepositHistory = emptyDepositFetch();
    const cursor = NOW - 2 * 60 * 60 * 1000;
    const deps = makeDeps({
      listHoldings: async () =>
        [
          { id: 'h-spot', metadata: { binanceAsset: 'BTC', binanceHistoryCursor: cursor } },
        ] as unknown as HoldingRow[],
      latestTransactionTime: async () => Date.UTC(2019, 0, 1),
      fetchDepositHistory,
    });

    await sync(deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows.map((window) => [window.startTime, window.endTime])).toEqual([
      [cursor, NOW],
      [NOW - 89 * DAY_MS, cursor],
    ]);
  });

  it('a same-account reconnect after a disconnect (watermark reset to the floor) walks from the floor, even with an old latest set', async () => {
    // Mirrors what a disconnect leaves behind (the watermark is
    // RESET to `HISTORY_FLOOR_MS`, not stripped) — a stale `latest` from
    // before the disconnect must not pull the walk forward past the floor.
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      listHoldings: async () =>
        [
          {
            id: 'h-spot',
            metadata: { binanceAsset: 'BTC', binanceHistoryCursor: HISTORY_FLOOR_MS },
          },
        ] as unknown as HoldingRow[],
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory,
    });

    await sync(deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows[0].startTime).toBe(HISTORY_FLOOR_MS);
  });

  it('imports nothing but still advances the watermark when the window holds no settled records', async () => {
    const deps = makeDeps({ latestTransactionTime: async () => NOW - 89 * DAY_MS });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).toHaveBeenCalledWith('h-spot', 'binanceHistoryCursor', NOW);
  });

  it('does nothing when the account has no Spot BTC holding', async () => {
    const deps = makeDeps({
      listHoldings: async () => [fundingHolding],
      fetchDepositHistory: jest.fn(async () => historyPage([deposit()])),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.fetchDepositHistory).not.toHaveBeenCalled();
    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('does nothing when no Binance credentials are stored', async () => {
    const deps = makeDeps({
      readCredentials: async () => undefined,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit()])),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.fetchDepositHistory).not.toHaveBeenCalled();
  });

  it('rejects when a history request fails so the caller can surface it', async () => {
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => {
        throw new Error('Too much request weight used');
      }),
    });

    await expect(sync(deps)).rejects.toThrow('Too much request weight used');
  });

  // The capital client parses strictly: an off-contract body or row throws a
  // BinanceHistoryParseError. The walk must let it through, so the earlier window
  // stays committed, the cursor stays at that window's end, and the run rejects.
  it('stops a walk on a capital parse error, keeping the earlier window and its cursor', async () => {
    let depositCalls = 0;
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 200 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => {
        depositCalls += 1;

        if (depositCalls === 2) {
          throw new BinanceHistoryParseError();
        }

        return historyPage([deposit({ id: 'window-1' })]);
      }),
    });

    await expect(sync(deps)).rejects.toBeInstanceOf(BinanceHistoryParseError);
    expect(deps.addTransactions).toHaveBeenCalledTimes(1);
    expect(cursorWritesOf(deps)).toEqual([FIRST_OF_THREE_WINDOWS_END]);
  });

  it('keys the same record identically across runs so a re-sync dedupes', async () => {
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ id: '42' })])),
    });

    await sync(deps);
    await sync(deps);

    expect(addedRows(deps, 0)[0].externalId).toBe('acc-1:deposit:42');
    expect(addedRows(deps, 1)[0].externalId).toBe('acc-1:deposit:42');
  });

  // Binance deposit/withdrawal record ids are only
  // per-account unique, so two connections can each emit `deposit:<id>` with the
  // SAME raw id. Namespacing by the target account id keeps their external ids
  // distinct, so the global (source, external_id) upsert cannot refresh the wrong
  // connection's row.
  it('namespaces the external id per account so two connections cannot collide on one raw id', async () => {
    const depsA = makeDeps({
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ id: '7' })])),
    });
    const depsB = makeDeps({
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ id: '7' })])),
    });

    await sync(depsA, 'acc-a');
    await sync(depsB, 'acc-b');

    expect(addedRows(depsA)[0].externalId).toBe('acc-a:deposit:7');
    expect(addedRows(depsB)[0].externalId).toBe('acc-b:deposit:7');
  });
});

// A cursor at the start of the newest 89-day window keeps each case's forward pass to that one
// window; the only ground behind it to re-scan is the overlap day.
const RECENT_CURSOR = async () => NOW - 89 * DAY_MS;

describe('wallet placement by walletType (C-matrix)', () => {
  it.each([
    ['C1', 0, 'h-spot'],
    ['C2', 1, 'h-funding'],
    ['C3', undefined, 'h-spot'],
  ])('%s: a deposit with walletType %s lands on %s', async (_row, walletType, holdingId) => {
    const deps = makeDeps({
      listHoldings: async () => [spotHolding, fundingHolding],
      latestTransactionTime: RECENT_CURSOR,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ walletType })])),
    });

    await sync(deps);

    expect(addedRows(deps)).toHaveLength(1);
    expect(addedRows(deps)[0].holdingId).toBe(holdingId);
    expect(deps.ensureHoldings).not.toHaveBeenCalled();
  });

  it.each([
    ['C1w', 0, 'h-spot'],
    ['C2w', 1, 'h-funding'],
    ['C3w', undefined, 'h-spot'],
  ])('%s: a withdrawal with walletType %s leaves from %s', async (_row, walletType, holdingId) => {
    const deps = makeDeps({
      listHoldings: async () => [spotHolding, fundingHolding],
      latestTransactionTime: RECENT_CURSOR,
      fetchWithdrawHistory: jest.fn(async () => historyPage([withdrawal({ walletType })])),
    });

    await sync(deps);

    expect(addedRows(deps)).toEqual([
      expect.objectContaining({ holdingId, amountMinorUnits: -25_000_000 }),
    ]);
  });

  it('places one window across both wallets, each row on its own holding', async () => {
    const deps = makeDeps({
      listHoldings: async () => [spotHolding, fundingHolding],
      latestTransactionTime: RECENT_CURSOR,
      fetchDepositHistory: jest.fn(async () =>
        historyPage([deposit({ id: 'a', walletType: 0 }), deposit({ id: 'b', walletType: 1 })]),
      ),
    });

    await sync(deps);

    expect(addedRows(deps).map((row) => [row.externalId, row.holdingId])).toEqual([
      ['acc-1:deposit:a', 'h-spot'],
      ['acc-1:deposit:b', 'h-funding'],
    ]);
  });

  it('P7: creates the missing Funding holding at zero, then places the row on it', async () => {
    let stored = [spotHolding];
    const ensureHoldings = jest.fn(async (_holdings: unknown[]) => {
      stored = [spotHolding, fundingHolding];
    });
    const deps = makeDeps({
      listHoldings: async () => stored,
      ensureHoldings,
      latestTransactionTime: RECENT_CURSOR,
      fetchDepositHistory: rowsAtNow([deposit({ walletType: 1 })]),
    });

    const result = await sync(deps);

    expect(ensureHoldings).toHaveBeenCalledTimes(1);
    expect(ensureHoldings).toHaveBeenCalledWith([
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        name: 'Binance Funding',
        balanceMinorUnits: 0,
        metadataField: 'binanceAsset',
        metadataKey: 'BTC:funding',
      }),
    ]);
    expect(addedRows(deps)[0].holdingId).toBe('h-funding');
    expect(result).toEqual({ imported: 1, complete: true });
  });

  it('P7: creates no wallet holding when every row planned for it already exists', async () => {
    const deps = makeDeps({
      storedExternalIds: jest.fn(async () => new Set(['acc-1:deposit:1'])),
      latestTransactionTime: RECENT_CURSOR,
      fetchDepositHistory: rowsAtNow([deposit({ walletType: 1 })]),
    });

    const result = await sync(deps);

    expect(deps.storedExternalIds).toHaveBeenCalledTimes(1);
    expect(deps.storedExternalIds).toHaveBeenCalledWith(['acc-1:deposit:1']);
    expect(deps.ensureHoldings).not.toHaveBeenCalled();
    expect(addedRows(deps).map((row) => [row.externalId, row.holdingId])).toEqual([
      ['acc-1:deposit:1', 'h-spot'],
    ]);
    expect(result).toEqual({ imported: 1, complete: true });
  });

  it('P7: creates the wallet holding once when one of its rows is new', async () => {
    let stored = [spotHolding];
    const ensureHoldings = jest.fn(async (_holdings: unknown[]) => {
      stored = [spotHolding, fundingHolding];
    });
    const deps = makeDeps({
      listHoldings: async () => stored,
      ensureHoldings,
      storedExternalIds: jest.fn(async () => new Set(['acc-1:deposit:1'])),
      latestTransactionTime: RECENT_CURSOR,
      fetchDepositHistory: rowsAtNow([
        deposit({ walletType: 1 }),
        deposit({ id: '8', walletType: 1 }),
      ]),
    });

    await sync(deps);

    expect(deps.storedExternalIds).toHaveBeenCalledTimes(1);
    expect(ensureHoldings).toHaveBeenCalledTimes(1);
    expect(addedRows(deps).map((row) => row.externalId)).toEqual([
      'acc-1:deposit:1',
      'acc-1:deposit:8',
    ]);
    expect(addedRows(deps)[1].holdingId).toBe('h-funding');
  });

  it('creates the Funding holding before the rows commit, and the rows before the cursor', async () => {
    const order: string[] = [];
    let stored = [spotHolding];
    const deps = makeDeps({
      listHoldings: async () => stored,
      ensureHoldings: jest.fn(async () => {
        order.push('ensureHoldings');
        stored = [spotHolding, fundingHolding];
      }),
      addTransactions: jest.fn(async (rows: BinanceTransactionRow[]) => {
        order.push('addTransactions');

        return rows.length;
      }),
      writeWalkCursor: jest.fn(async () => {
        order.push('writeWalkCursor');
      }),
      latestTransactionTime: RECENT_CURSOR,
      fetchDepositHistory: rowsAtNow([deposit({ walletType: 1 })]),
    });

    await sync(deps);

    expect(order.slice(0, 3)).toEqual(['ensureHoldings', 'addTransactions', 'writeWalkCursor']);
  });
});

// A SETTLED row the walk cannot place or trust stops its window: nothing of the
// window commits and the cursor stays. A skipped row would be silent loss.
describe('a settled capital row the walk cannot trust stops its window', () => {
  const STOP_TAG = '[binance sync] history window stopped';
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  // A good row rides along in the deposit window, so the stop is proven to discard
  // the whole window and not only the bad row.
  const badDeposit = (over: Partial<BinanceDeposit>): Partial<BinanceTransactionSyncDeps> => ({
    fetchDepositHistory: forwardRowsAt(NOW - 89 * DAY_MS, [
      deposit(),
      deposit({ id: '2', ...over }),
    ]),
  });

  const badWithdrawal = (
    over: Partial<BinanceWithdrawal>,
  ): Partial<BinanceTransactionSyncDeps> => ({
    fetchWithdrawHistory: forwardRowsAt(NOW - 89 * DAY_MS, [withdrawal({ id: '2', ...over })]),
  });

  const BAD_ROWS: [string, string, () => Partial<BinanceTransactionSyncDeps>][] = [
    ['C4 deposit', 'capital-wallet-unknown', () => badDeposit({ walletType: 7 })],
    ['C4w withdrawal', 'capital-wallet-unknown', () => badWithdrawal({ walletType: 7 })],
    ['C5 deposit', 'capital-amount-invalid', () => badDeposit({ amount: 'abc' })],
    ['C5w withdrawal', 'capital-amount-invalid', () => badWithdrawal({ amount: 'abc' })],
    ['C5 blank deposit', 'capital-amount-invalid', () => badDeposit({ amount: '' })],
    ['C5 blank withdrawal', 'capital-amount-invalid', () => badWithdrawal({ amount: '  ' })],
    ['C6 deposit', 'capital-time-invalid', () => badDeposit({ insertTime: Number.NaN })],
    ['C6w withdrawal', 'capital-time-invalid', () => badWithdrawal({ applyTime: 'not a date' })],
    ['C7 deposit', 'capital-id-missing', () => badDeposit({ id: '', txId: '' })],
    ['C7w withdrawal', 'capital-id-missing', () => badWithdrawal({ id: '', txId: '' })],
  ];

  it.each(BAD_ROWS)('%s: stops the window with %s', async (_row, code, reads) => {
    const deps = makeDeps({ latestTransactionTime: RECENT_CURSOR, ...reads() });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([[STOP_TAG, { name: 'BinanceWalkStop', code }]]);
  });

  it('ignores an UNSETTLED row with the same defects instead of stopping', async () => {
    const deps = makeDeps({
      latestTransactionTime: RECENT_CURSOR,
      fetchDepositHistory: rowsAtNow([
        deposit({ id: '', txId: '', amount: 'abc', status: 0, walletType: 7 }),
        deposit({ id: '3' }),
      ]),
      fetchWithdrawHistory: rowsAtNow([
        withdrawal({ id: '', txId: '', amount: 'abc', applyTime: 'x', status: 3 }),
      ]),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:deposit:3']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the earlier window committed and its cursor when a later window stops, and still reads the re-scan', async () => {
    let depositCalls = 0;
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 200 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => {
        depositCalls += 1;

        return historyPage(
          depositCalls === 2 ? [deposit({ amount: 'abc' })] : [deposit({ id: `w${depositCalls}` })],
        );
      }),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 2, complete: false });
    expect(deps.addTransactions).toHaveBeenCalledTimes(2);
    expect(cursorWritesOf(deps)).toEqual([FIRST_OF_THREE_WINDOWS_END]);
    // The two forward windows, then the re-scan: the overlap day behind the cursor it started at.
    expect(
      (deps.fetchDepositHistory as jest.Mock).mock.calls.map((call) => [
        (call[2] as HistoryWindow).startTime,
        (call[2] as HistoryWindow).endTime,
      ]),
    ).toEqual([
      [NOW - 200 * DAY_MS, FIRST_OF_THREE_WINDOWS_END],
      [FIRST_OF_THREE_WINDOWS_END, FIRST_OF_THREE_WINDOWS_END + 89 * DAY_MS],
      [NOW - 200 * DAY_MS - DAY_MS, NOW - 200 * DAY_MS],
    ]);
  });

  it('stops when the placement holding is still absent after it was created', async () => {
    const deps = makeDeps({
      latestTransactionTime: RECENT_CURSOR,
      fetchDepositHistory: rowsAtNow([deposit({ walletType: 1 })]),
    });

    const result = await sync(deps);

    expect(deps.ensureHoldings).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([
      [STOP_TAG, { name: 'BinanceWalkStop', code: 'capital-holding-missing' }],
    ]);
  });
});

// Each `it` below uses its OWN account id — `cooldownUntilByAccount` is
// module-level, so a shared id would leak a cooldown from one case into the
// next. There is no exported reset (no test code in `src/`).
describe('resumable, budgeted walk', () => {
  it('a first sync completes over several runs, each staying within the withdraw-call budget', async () => {
    let clock = NOW;
    const account = makeStatefulSpotAccount();
    // A per-UTC-minute call counter mirrors Binance's real weight ceiling: more
    // than 10 withdraw calls in one minute 429s. The fallback budget (9 per
    // run) must keep every run safely under this.
    let callsThisMinute = 0;
    let minuteBucket = -1;
    const fetchWithdrawHistory = jest.fn(async () => {
      const bucket = Math.floor(clock / 60_000);

      if (bucket !== minuteBucket) {
        minuteBucket = bucket;
        callsThisMinute = 0;
      }

      callsThisMinute += 1;

      if (callsThisMinute > 10) {
        throw new BinanceRateLimitError(429, 30_000);
      }

      return historyPage([withdrawal({ id: `w-${bucket}-${callsThisMinute}` })]);
    });
    const deps = makeFirstSyncDeps(account, { now: () => clock, fetchWithdrawHistory });

    let complete = false;
    let totalImported = 0;
    let runs = 0;
    let lastRunNow = clock;

    while (!complete && runs < 10) {
      lastRunNow = clock;
      const result = await sync(deps, 'acc-first-sync');
      complete = result.complete;
      totalImported += result.imported;
      runs += 1;
      clock += 61_000;
    }

    expect(complete).toBe(true);
    expect(runs).toBeGreaterThan(1);
    // Each run's own "now" moves forward with the clock; the finished walk
    // catches up to THAT run's own now, not the constant `NOW` the test started at.
    expect(account.cursor()).toBe(lastRunNow);
    expect(totalImported).toBeGreaterThan(0);
    // No call ever rejected — the fallback budget kept every run under the
    // fake's own 10-per-minute ceiling.
    expect(fetchWithdrawHistory.mock.results.every((call) => call.type !== 'throw')).toBe(true);
  });

  it('run 1 makes at most the capital withdraw lane cap, one window per call', async () => {
    const account = makeStatefulSpotAccount();
    const fetchWithdrawHistory = jest.fn(async () => historyPage([withdrawal()]));
    const deps = makeFirstSyncDeps(account, { fetchWithdrawHistory });

    const result = await sync(deps, 'acc-budget');

    expect(LANE_CALL_CAPS.capitalWithdraw).toBe(9);
    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(LANE_CALL_CAPS.capitalWithdraw);
    expect(result.complete).toBe(false);
  });

  it('draws on the shared run: a withdraw lane already spent makes no request at all', async () => {
    const run = freshRun();

    for (let call = 0; call < LANE_CALL_CAPS.capitalWithdraw; call += 1) {
      run.budget.record('capitalWithdraw', {
        usedUidWeight1m: undefined,
        usedIpWeight1m: undefined,
      });
    }

    const deps = makeDeps({ latestTransactionTime: RECENT_CURSOR });

    const result = await sync(deps, 'acc-spent-lane', run);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchDepositHistory).not.toHaveBeenCalled();
    expect(deps.fetchWithdrawHistory).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
  });

  it('records what the walk spends on the shared run, so a later walk sees it', async () => {
    const run = freshRun();
    const deps = makeDeps({
      latestTransactionTime: RECENT_CURSOR,
      fetchWithdrawHistory: jest.fn(async () => historyPage([], 178_000, undefined)),
    });

    await sync(deps, 'acc-shared-reading', run);

    expect(run.budget.canAfford('pay', COSTS.pay)).toBe(false);
  });

  it('a 429 stops the walk without rejecting, commits every EARLIER window, and cools down until Retry-After passes', async () => {
    const account = makeStatefulSpotAccount();
    let callCount = 0;
    const fetchWithdrawHistory = jest.fn(async () => {
      callCount += 1;

      if (callCount === 3) {
        throw new BinanceRateLimitError(429, 30_000);
      }

      return historyPage([]);
    });
    const depositWindows: HistoryWindow[] = [];
    const fetchDepositHistory = jest.fn(
      async (_key: string, _secret: string, window: HistoryWindow) => {
        depositWindows.push(window);

        return historyPage([]);
      },
    );
    let clock = NOW;
    const deps = makeFirstSyncDeps(account, {
      now: () => clock,
      fetchDepositHistory,
      fetchWithdrawHistory,
    });

    const run1 = await sync(deps, 'acc-429');

    expect(run1).toEqual({ imported: 0, complete: false });
    // 2 windows committed (withdraw calls 1 and 2 succeeded); the 3rd's window is not.
    expect(account.writeWalkCursor).toHaveBeenCalledTimes(2);

    const callsAfterRun1 = fetchWithdrawHistory.mock.calls.length;
    const firstWindowStart = depositWindows[0].startTime;

    clock += 10_000;
    const run2 = await sync(deps, 'acc-429');

    expect(run2).toEqual({ imported: 0, complete: false });
    expect(fetchWithdrawHistory.mock.calls.length).toBe(callsAfterRun1);

    clock += 21_000; // 31s total since the 429 — Retry-After has passed
    await sync(deps, 'acc-429');

    expect(fetchWithdrawHistory.mock.calls.length).toBeGreaterThan(callsAfterRun1);
    // Resumes from the cursor, not a re-walk from the floor.
    const resumedWindowStart = depositWindows[depositWindows.length - 1].startTime;
    expect(resumedWindowStart).toBeGreaterThan(firstWindowStart);
  });

  const RATE_LIMITS: [string, string, 418 | 429, number, number][] = [
    [
      'a 429 with no Retry-After header falls back to the default cooldown',
      'acc-default-cooldown',
      429,
      60_000,
      59_000,
    ],
    [
      'a 418 IP ban is treated the same as a 429, with its own Retry-After',
      'acc-418',
      418,
      45_000,
      44_000,
    ],
  ];

  it.each(RATE_LIMITS)('%s', async (_name, accountId, status, retryAfterMs, elapsedMs) => {
    const account = makeStatefulSpotAccount();
    let clock = NOW;
    const fetchWithdrawHistory = jest.fn(async () => {
      throw new BinanceRateLimitError(status, retryAfterMs);
    });
    const deps = makeFirstSyncDeps(account, { now: () => clock, fetchWithdrawHistory });

    const firstRun = await sync(deps, accountId);

    expect(firstRun).toEqual({ imported: 0, complete: false });

    clock += elapsedMs;
    const stillCoolingDown = await sync(deps, accountId);

    expect(stillCoolingDown).toEqual({ imported: 0, complete: false });
    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(1);
  });

  it('the used-UID-weight header stops the run after the window it was reported on', async () => {
    const account = makeStatefulSpotAccount();
    // Leaves no room for another withdraw call (one more would exceed the
    // per-minute ceiling).
    const reportedWeight = UID_WEIGHT_BUDGET_1M - COSTS.withdraw.uid + 1;
    const fetchWithdrawHistory = jest.fn(async () =>
      historyPage<BinanceWithdrawal>([], reportedWeight),
    );
    const deps = makeFirstSyncDeps(account, { fetchWithdrawHistory });

    const result = await sync(deps, 'acc-weight');

    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(1);
    expect(result.complete).toBe(false);
    expect(account.writeWalkCursor).toHaveBeenCalledTimes(1);
  });

  it('a deposit page that leaves no IP room stops the window before the next deposit call', async () => {
    const fetchDepositHistory = jest.fn(async () =>
      historyPage(fullDepositPage(), undefined, 6_000),
    );
    const deps = makeDeps({ latestTransactionTime: RECENT_CURSOR, fetchDepositHistory });

    const result = await sync(deps, 'acc-ip-full');

    expect(result).toEqual({ imported: 0, complete: false });
    expect(fetchDepositHistory).toHaveBeenCalledTimes(1);
    expect(deps.fetchWithdrawHistory).not.toHaveBeenCalled();
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeWalkCursor).not.toHaveBeenCalled();
  });

  it('a deposit page that leaves room for exactly one more IP weight lets the walk go on with the half', async () => {
    const fetchDepositHistory = jest.fn(
      async (_key: string, _secret: string, window: HistoryWindow) =>
        window.endTime === NOW && window.startTime === NOW - 89 * DAY_MS
          ? historyPage(fullDepositPage(), undefined, 5_999)
          : historyPage([]),
    );
    const deps = makeDeps({ latestTransactionTime: RECENT_CURSOR, fetchDepositHistory });

    const result = await sync(deps, 'acc-ip-room');

    expect(fetchDepositHistory.mock.calls.length).toBeGreaterThan(1);
    expect(result).toEqual({ imported: 0, complete: true });
  });

  it('a window needing a 2nd withdraw page when only 1 call is left is not committed and not marked', async () => {
    const account = makeStatefulSpotAccount();
    const fullPage = Array.from({ length: HISTORY_PAGE_LIMIT }, (_unused, index) =>
      withdrawal({ id: `w${index}` }),
    );
    let callCount = 0;
    const fetchWithdrawHistory = jest.fn(async () => {
      callCount += 1;

      // The LAST call the budget can afford starts a window whose first page
      // is FULL — it needs a 2nd page, a call the budget does not allow.
      if (callCount === LANE_CALL_CAPS.capitalWithdraw) {
        return historyPage(fullPage);
      }

      return historyPage([]);
    });
    const deps = makeFirstSyncDeps(account, { fetchWithdrawHistory });

    const result = await sync(deps, 'acc-partial-window');

    expect(result.complete).toBe(false);
    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(LANE_CALL_CAPS.capitalWithdraw);
    // The 8 EARLIER windows committed; the 9th (the unfinished one) did not.
    expect(account.writeWalkCursor).toHaveBeenCalledTimes(LANE_CALL_CAPS.capitalWithdraw - 1);
  });

  it('crash order: rows commit before the watermark advances, for the same window', async () => {
    const account = makeStatefulSpotAccount();
    const invocationCallOrder: string[] = [];
    const addTransactions = jest.fn(async (rows: BinanceTransactionRow[]) => {
      invocationCallOrder.push('addTransactions');

      return rows.length;
    });
    const writeWalkCursor = jest.fn(async (holdingId: string, field: string, cursorMs: number) => {
      invocationCallOrder.push('writeWalkCursor');
      await account.writeWalkCursor(holdingId, field, cursorMs);
    });
    const writeWalkPending = jest.fn(
      async (holdingId: string, field: string, ranges: WalkWindow[]) => {
        invocationCallOrder.push('writeWalkPending');
        await account.writeWalkPending(holdingId, field, ranges);
      },
    );
    const deps = makeDeps({
      listHoldings: account.listHoldings,
      writeWalkCursor,
      writeWalkPending,
      addTransactions,
      latestTransactionTime: async () => NOW - 89 * DAY_MS,
      fetchDepositHistory: rowsAtNow([deposit()]),
      fetchWithdrawHistory: jest.fn(async () => historyPage([])),
    });

    await sync(deps, 'acc-crash-order');

    // The owed overlap day is stored before the cursor moves, and leaves the list once the
    // re-scan has read it.
    expect(invocationCallOrder).toEqual([
      'addTransactions',
      'writeWalkPending',
      'writeWalkCursor',
      'writeWalkPending',
    ]);
  });

  it('regression: rows from an earlier, committed window ARE written despite a later 429 (inverse of the all-or-nothing bug)', async () => {
    const account = makeStatefulSpotAccount();
    let callCount = 0;
    const fetchWithdrawHistory = jest.fn(async () => {
      callCount += 1;

      if (callCount === 2) {
        throw new BinanceRateLimitError(429, 30_000);
      }

      return historyPage([withdrawal({ id: `w${callCount}` })]);
    });
    const addTransactions = jest.fn(async (rows: BinanceTransactionRow[]) => rows.length);
    const deps = makeFirstSyncDeps(account, { addTransactions, fetchWithdrawHistory });

    const result = await sync(deps, 'acc-regression');

    expect(result.complete).toBe(false);
    // The 1st window's row WAS written before the 2nd window's 429 — the
    // opposite of the all-or-nothing bug this walk replaces.
    expect(addTransactions).toHaveBeenCalledTimes(1);
    expect(addTransactions.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('the capital re-scan', () => {
  const FORWARD_FIELD = 'binanceHistoryCursor';
  const RESCAN_FIELD = 'binanceHistoryRescanCursor';

  const accountWith = async (marks: Record<string, number>) => {
    const account = makeStatefulSpotAccount();

    for (const [field, cursorMs] of Object.entries(marks)) {
      await account.writeWalkCursor('h-spot', field, cursorMs);
    }
    account.writeWalkCursor.mockClear();

    return account;
  };

  const writesTo = (account: StatefulSpotAccount, field: string): number[] =>
    account.writeWalkCursor.mock.calls.filter((call) => call[1] === field).map((call) => call[2]);

  it('resumes from its stored cursor', async () => {
    const account = await accountWith({
      [FORWARD_FIELD]: NOW - 2 * DAY_MS,
      [RESCAN_FIELD]: NOW - 40 * DAY_MS,
    });
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeFirstSyncDeps(account, { fetchDepositHistory });

    await sync(deps);

    expect(fetchDepositHistory.mock.calls.map((call) => call[2])).toEqual([
      { startTime: NOW - 2 * DAY_MS, endTime: NOW, offset: 0 },
      { startTime: NOW - 40 * DAY_MS, endTime: NOW - 2 * DAY_MS, offset: 0 },
    ]);
  });

  it('writes the capital cursor for the forward pass and the restart mark when the re-scan ends', async () => {
    const account = await accountWith({
      [FORWARD_FIELD]: NOW - 2 * DAY_MS,
      [RESCAN_FIELD]: NOW - 40 * DAY_MS,
    });

    const result = await sync(makeFirstSyncDeps(account));

    expect(result).toEqual({ imported: 0, complete: true });
    expect(writesTo(account, FORWARD_FIELD)).toEqual([NOW]);
    expect(writesTo(account, RESCAN_FIELD)).toEqual([HISTORY_FLOOR_MS]);
  });

  it('starts a new pass at the window start once the stored cursor is the restart mark', async () => {
    const account = await accountWith({
      [FORWARD_FIELD]: NOW - 2 * DAY_MS,
      [RESCAN_FIELD]: HISTORY_FLOOR_MS,
    });
    const fetchDepositHistory = emptyDepositFetch();

    const result = await sync(makeFirstSyncDeps(account, { fetchDepositHistory }));

    expect(fetchDepositHistory.mock.calls[1][2].startTime).toBe(NOW - 89 * DAY_MS);
    expect(result.complete).toBe(true);
    expect(writesTo(account, RESCAN_FIELD)).toEqual([]);
  });

  it('writes no re-scan cursor on a light account that has no pass in progress', async () => {
    const account = await accountWith({ [FORWARD_FIELD]: NOW - 3_600_000 });

    const result = await sync(makeFirstSyncDeps(account));

    expect(result).toEqual({ imported: 0, complete: true });
    expect(writesTo(account, RESCAN_FIELD)).toEqual([]);
  });

  it('leaves the re-scan alone while the forward pass is still going', async () => {
    const account = await accountWith({ [FORWARD_FIELD]: NOW - 60 * DAY_MS });
    const records = Array.from({ length: 6_000 }, (_unused, index) =>
      withdrawal({ id: `w${index}`, applyTime: NOW - 60 * DAY_MS + index * 60_000 }),
    );

    const result = await sync(
      makeFirstSyncDeps(account, { fetchWithdrawHistory: withdrawalServer(records) }),
    );

    expect(result.complete).toBe(false);
    expect(writesTo(account, FORWARD_FIELD).length).toBeGreaterThan(0);
    expect(writesTo(account, RESCAN_FIELD)).toEqual([]);
  });

  it('does not re-scan at all after a disconnect reset every cursor to the floor', async () => {
    const account = await accountWith({
      [FORWARD_FIELD]: HISTORY_FLOOR_MS,
      [RESCAN_FIELD]: HISTORY_FLOOR_MS,
    });
    const fetchDepositHistory = emptyDepositFetch();

    await sync(makeFirstSyncDeps(account, { fetchDepositHistory }));

    expect(fetchDepositHistory.mock.calls[0][2].startTime).toBe(HISTORY_FLOOR_MS);
    expect(writesTo(account, RESCAN_FIELD)).toEqual([]);
  });

  it('never moves the capital cursor back when a halved span ends behind it', async () => {
    const account = await accountWith({ [FORWARD_FIELD]: NOW - 3_600_000 });
    const fetchDepositHistory = depositServer([
      ...fullDepositPage(),
      deposit({ id: 'late', insertTime: NOW - 1_000 }),
    ]);

    await sync(makeFirstSyncDeps(account, { fetchDepositHistory }));

    const forward = writesTo(account, FORWARD_FIELD);
    expect(forward.length).toBeGreaterThan(0);
    expect(forward.every((cursor, index) => index === 0 || cursor >= forward[index - 1])).toBe(
      true,
    );
    expect(forward.every((cursor) => cursor >= NOW - 3_600_000)).toBe(true);
  });
});

/** A Binance withdraw history that answers as it does: the span's records, a page at a time. */
const withdrawalServer = (all: BinanceWithdrawal[]) =>
  jest.fn(async (_apiKey: string, _secret: string, window: HistoryWindow) => {
    const inRange = all
      .filter((record) => {
        const time = parseWithdrawTime(record.applyTime);

        return time >= window.startTime && time <= window.endTime;
      })
      .sort(
        (left, right) =>
          parseWithdrawTime(right.applyTime) - parseWithdrawTime(left.applyTime) ||
          left.id.localeCompare(right.id),
      );

    return historyPage(inRange.slice(window.offset, window.offset + HISTORY_PAGE_LIMIT));
  });

describe('forward progress on a heavy account', () => {
  const ACCOUNT = 'acc-heavy';
  const HEAVY_COUNT = 12_000;
  const SPAN_MS = 88 * DAY_MS - 1_000;
  // 12000 withdrawals in 88 days: the last 89 days need 13 pages, and one run affords 9.
  const heavyWithdrawals = Array.from({ length: HEAVY_COUNT }, (_unused, index) =>
    withdrawal({
      id: `w${index}`,
      applyTime: NOW - 88 * DAY_MS + Math.floor((index * SPAN_MS) / HEAVY_COUNT),
    }),
  );
  const keyOf = (record: BinanceWithdrawal): string => `${ACCOUNT}:withdraw:${record.id}`;

  type HeavyState = {
    account: ReturnType<typeof makeStatefulSpotAccount>;
    imported: Set<string>;
  };

  /** A heavy account whose capital cursor is 2 days behind. */
  const heavyState = async (): Promise<HeavyState> => {
    const account = makeStatefulSpotAccount();
    await account.writeWalkCursor('h-spot', 'binanceHistoryCursor', NOW - 2 * DAY_MS);

    return { account, imported: new Set() };
  };

  /** One run over the stored state; a key the state already holds is not imported again. */
  const runOver = async (state: HeavyState) => {
    const deps = makeFirstSyncDeps(state.account, {
      fetchWithdrawHistory: withdrawalServer(heavyWithdrawals),
      addTransactions: jest.fn(async (rows: BinanceTransactionRow[]) => {
        const fresh = rows.filter((row) => !state.imported.has(row.externalId));

        for (const row of fresh) {
          state.imported.add(row.externalId);
        }

        return fresh.length;
      }),
    });

    return sync(deps, ACCOUNT, freshRun());
  };

  const runsUntilComplete = async (state: HeavyState): Promise<boolean[]> => {
    const runs: boolean[] = [];

    for (let attempt = 0; attempt < 12 && runs.at(-1) !== true; attempt += 1) {
      runs.push((await runOver(state)).complete);
    }

    return runs;
  };

  it('imports the newest records on the first run, and the forward cursor reaches the end', async () => {
    const state = await heavyState();

    const result = await runOver(state);

    const newest = heavyWithdrawals.filter(
      (record) => parseWithdrawTime(record.applyTime) >= NOW - 2 * DAY_MS,
    );
    expect(newest.length).toBeGreaterThan(0);
    expect(newest.every((record) => state.imported.has(keyOf(record)))).toBe(true);
    expect(state.account.cursor()).toBe(NOW);
    expect(result.complete).toBe(false);
  });

  it('finishes the re-scan over later runs and imports every record once', async () => {
    const state = await heavyState();

    const runs = await runsUntilComplete(state);

    expect(runs.length).toBeGreaterThan(1);
    expect(runs.at(-1)).toBe(true);
    expect(state.imported.size).toBe(HEAVY_COUNT);
    expect(state.account.cursor()).toBe(NOW);
    expect(state.account.rescanCursor()).toBe(HISTORY_FLOOR_MS);
  });

  it('imports nothing on a second identical run after the re-scan finished', async () => {
    const state = await heavyState();
    await runsUntilComplete(state);

    const again = await runOver(state);

    expect(again.imported).toBe(0);
    expect(state.imported.size).toBe(HEAVY_COUNT);
  });
});

describe('forward progress with a dense day just behind the cursor', () => {
  const ACCOUNT = 'acc-dense';
  const CURSOR = NOW - 2 * DAY_MS;
  // 4000 withdrawals fill the day before the cursor: more calls than one run affords. A
  // forward pass that restarted a day behind the cursor would spend every run on that day,
  // and the cursor, which only a span ending after it moves, would never reach newer records.
  const denseDay = Array.from({ length: 4_000 }, (_unused, index) =>
    withdrawal({ id: `dense-${index}`, applyTime: CURSOR - DAY_MS + index * 20_000 }),
  );
  const newer = [1, 2, 3].map((hours) =>
    withdrawal({ id: `newer-${hours}`, applyTime: CURSOR + hours * 3_600_000 }),
  );
  const records = [...denseDay, ...newer];
  const keyOf = (record: BinanceWithdrawal): string => `${ACCOUNT}:withdraw:${record.id}`;

  const denseState = async () => {
    const account = makeStatefulSpotAccount();
    await account.writeWalkCursor('h-spot', 'binanceHistoryCursor', CURSOR);

    return { account, imported: new Set<string>() };
  };

  const runOver = async (state: Awaited<ReturnType<typeof denseState>>) =>
    sync(
      makeFirstSyncDeps(state.account, {
        fetchWithdrawHistory: withdrawalServer(records),
        addTransactions: jest.fn(async (rows: BinanceTransactionRow[]) => {
          const fresh = rows.filter((row) => !state.imported.has(row.externalId));

          for (const row of fresh) {
            state.imported.add(row.externalId);
          }

          return fresh.length;
        }),
      }),
      ACCOUNT,
      freshRun(),
    );

  const runUntilComplete = async (state: Awaited<ReturnType<typeof denseState>>) => {
    const runs: boolean[] = [];

    for (let attempt = 0; attempt < 30 && runs.at(-1) !== true; attempt += 1) {
      runs.push((await runOver(state)).complete);
    }

    return runs;
  };

  it('imports the records after the cursor and moves the cursor to the end on the first run', async () => {
    const state = await denseState();

    await runOver(state);

    expect(newer.every((record) => state.imported.has(keyOf(record)))).toBe(true);
    expect(state.account.cursor()).toBe(NOW);
  });

  it('still re-scans the dense day over later runs, importing every record once', async () => {
    const state = await denseState();

    const runs = await runUntilComplete(state);

    expect(runs.length).toBeGreaterThan(1);
    expect(runs.at(-1)).toBe(true);
    expect(state.imported.size).toBe(records.length);
    expect(state.account.rescanCursor()).toBe(HISTORY_FLOOR_MS);
  });

  it('imports nothing on a second identical run after the re-scan finished', async () => {
    const state = await denseState();
    await runUntilComplete(state);

    const again = await runOver(state);

    expect(again.imported).toBe(0);
    expect(state.imported.size).toBe(records.length);
  });
});

describe('a capital cursor older than the re-scan window', () => {
  const ACCOUNT = 'acc-old-cursor';
  const FORWARD_FIELD = 'binanceHistoryCursor';
  const RESCAN_FIELD = 'binanceHistoryRescanCursor';
  const CURSOR = NOW - 120 * DAY_MS;
  const keyOf = (record: BinanceWithdrawal): string => `${ACCOUNT}:withdraw:${record.id}`;

  const oldCursorState = async (cursor = CURSOR) => {
    const account = makeStatefulSpotAccount();
    await account.writeWalkCursor('h-spot', FORWARD_FIELD, cursor);
    account.writeWalkCursor.mockClear();

    return { account, imported: new Set<string>() };
  };

  type OldCursorState = Awaited<ReturnType<typeof oldCursorState>>;

  /** One run over the stored state; a key the state already holds is not imported again. */
  const runOver = (state: OldCursorState, records: BinanceWithdrawal[], at = NOW) =>
    sync(
      makeFirstSyncDeps(state.account, {
        now: () => at,
        fetchWithdrawHistory: withdrawalServer(records),
        addTransactions: jest.fn(async (rows: BinanceTransactionRow[]) => {
          const fresh = rows.filter((row) => !state.imported.has(row.externalId));

          for (const row of fresh) {
            state.imported.add(row.externalId);
          }

          return fresh.length;
        }),
      }),
      ACCOUNT,
      freshRun(() => at),
    );

  const runUntilComplete = async (
    state: OldCursorState,
    recordsOf: (attempt: number) => BinanceWithdrawal[],
  ) => {
    const runs: boolean[] = [];

    for (let attempt = 0; attempt < 30 && runs.at(-1) !== true; attempt += 1) {
      runs.push((await runOver(state, recordsOf(attempt))).complete);
    }

    return runs;
  };

  // 4000 withdrawals fill the day behind the cursor: more calls than one run affords. A
  // forward pass that restarted the overlap behind the cursor would spend every run on that
  // day, and never reach the newer records.
  it('reaches now and imports every record once, with a dense day just behind the cursor', async () => {
    const denseDay = Array.from({ length: 4_000 }, (_unused, index) =>
      withdrawal({ id: `dense-${index}`, applyTime: CURSOR - DAY_MS + index * 20_000 }),
    );
    const newer = [1, 2, 3].map((hours) =>
      withdrawal({ id: `newer-${hours}`, applyTime: CURSOR + hours * 3_600_000 }),
    );
    const records = [...denseDay, ...newer];
    const state = await oldCursorState();

    await runOver(state, records);

    expect(state.account.cursor()).toBe(NOW);
    expect(newer.every((record) => state.imported.has(keyOf(record)))).toBe(true);

    const runs = await runUntilComplete(state, () => records);

    expect(runs.at(-1)).toBe(true);
    expect(runs.length).toBeLessThanOrEqual(6);
    expect(state.imported.size).toBe(records.length);
    expect(state.account.rescanCursor()).toBe(HISTORY_FLOOR_MS);
  });

  // The record was pending at the last sync, so it was missing then and settles in the
  // overlap day behind the cursor; the walk was away for 88.5 days, so the window start cuts
  // that day in two.
  it('imports a record that settled late in the overlap day, after an absence of 88.5 days', async () => {
    const cursor = NOW - 88.5 * DAY_MS;
    const late = withdrawal({ id: 'late', applyTime: cursor - 0.75 * DAY_MS });
    const state = await oldCursorState(cursor);

    await runOver(state, [late]);

    expect(state.imported.has(keyOf(late))).toBe(true);
  });

  it('imports a record that settled late behind the old cursor, though the catch-up took several runs', async () => {
    const late = withdrawal({ id: 'late', applyTime: CURSOR - 0.5 * DAY_MS });
    const busy = Array.from({ length: 12_000 }, (_unused, index) =>
      withdrawal({ id: `busy-${index}`, applyTime: CURSOR + 1 + index * 600_000 }),
    );
    const state = await oldCursorState();

    const runs = await runUntilComplete(state, (attempt) =>
      attempt === 0 ? busy : [...busy, late],
    );

    expect(runs.length).toBeGreaterThan(2);
    expect(runs.at(-1)).toBe(true);
    expect(state.account.cursor()).toBe(NOW);
    expect(state.imported.size).toBe(busy.length + 1);
    expect(state.imported.has(keyOf(late))).toBe(true);
  });

  it('stores the owed overlap day behind the old cursor before it moves the cursor', async () => {
    const state = await oldCursorState();
    const writes: string[] = [];
    state.account.writeWalkCursor.mockImplementation(async (_id, field) => {
      writes.push(field);
    });
    state.account.writeWalkPending.mockImplementation(async (_id, field) => {
      writes.push(field);
    });

    await runOver(state, []);

    expect(writes.slice(0, 2)).toEqual(['binanceHistoryPendingOverlap', FORWARD_FIELD]);
    expect(state.account.writeWalkPending.mock.calls[0]).toEqual([
      'h-spot',
      'binanceHistoryPendingOverlap',
      [{ start: CURSOR - DAY_MS, end: CURSOR }],
    ]);
  });

  // A re-scan mark the sliding window has outrun is a pass the window does not reach any
  // more: the run starts a new pass at the window start, so a record in the window behind
  // the cursor is read at once, wherever the old mark lay.
  it('starts a new pass at the window start for a mark the window outran, whatever the distance', async () => {
    const late = withdrawal({ id: 'late', applyTime: NOW - 5 * DAY_MS });
    const state = await oldCursorState(NOW);
    await state.account.writeWalkCursor('h-spot', RESCAN_FIELD, CURSOR);

    await runOver(state, [late]);

    expect(state.imported.has(keyOf(late))).toBe(true);
  });
});

describe('the pending overlap days of the capital walk', () => {
  const ACCOUNT = 'acc-pending';
  const FORWARD_FIELD = 'binanceHistoryCursor';
  const SUSPENDED = 'run suspended';
  const keyOf = (record: BinanceWithdrawal): string => `${ACCOUNT}:withdraw:${record.id}`;

  const stateOf = async (cursor: number | null, pending: OwedGround[] = []) => {
    const account = makeStatefulSpotAccount();

    if (cursor !== null) {
      await account.writeWalkCursor('h-spot', FORWARD_FIELD, cursor);
    }
    await account.writeWalkPending('h-spot', 'binanceHistoryPendingOverlap', pending);

    return { account, imported: new Set<string>() };
  };

  type PendingState = Awaited<ReturnType<typeof stateOf>>;

  /** A withdraw history that answers `after` calls, then fails like a run that was killed. */
  const suspendedAfter = (after: number, records: BinanceWithdrawal[]) => {
    const inner = withdrawalServer(records);
    let calls = 0;

    return jest.fn(async (apiKey: string, secret: string, window: HistoryWindow) => {
      calls += 1;

      if (calls > after) {
        throw new Error(SUSPENDED);
      }

      return inner(apiKey, secret, window);
    });
  };

  const runOver = (
    state: PendingState,
    records: BinanceWithdrawal[],
    at = NOW,
    over: Partial<BinanceTransactionSyncDeps> = {},
  ) => {
    const deps = makeFirstSyncDeps(state.account, {
      now: () => at,
      fetchWithdrawHistory: withdrawalServer(records),
      addTransactions: jest.fn(async (rows: BinanceTransactionRow[]) => {
        const fresh = rows.filter((row) => !state.imported.has(row.externalId));

        for (const row of fresh) {
          state.imported.add(row.externalId);
        }

        return fresh.length;
      }),
      ...over,
    });

    return sync(
      deps,
      ACCOUNT,
      freshRun(() => at),
    ).then((result) => ({ deps, result }));
  };

  const withdrawStartsOf = (deps: BinanceTransactionSyncDeps): number[] =>
    (deps.fetchWithdrawHistory as jest.Mock).mock.calls.map(
      (call) => (call[2] as HistoryWindow).startTime,
    );

  const runUntilComplete = async (
    state: PendingState,
    recordsOf: (attempt: number) => BinanceWithdrawal[],
  ) => {
    const runs: boolean[] = [];

    for (let attempt = 0; attempt < 40 && runs.at(-1) !== true; attempt += 1) {
      runs.push((await runOver(state, recordsOf(attempt))).result.complete);
    }

    return runs;
  };

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the overlap day of each of two cursors after two absences longer than the window, the first run cut after its forward pass', async () => {
    const firstRunAt = NOW - 95 * DAY_MS;
    const firstCursor = firstRunAt - 95 * DAY_MS;
    const lateBehindFirst = withdrawal({ id: 'late-first', applyTime: firstCursor - 0.5 * DAY_MS });
    const lateBehindSecond = withdrawal({
      id: 'late-second',
      applyTime: firstRunAt - 0.5 * DAY_MS,
    });
    const state = await stateOf(firstCursor);

    await expect(
      runOver(state, [], firstRunAt, { fetchWithdrawHistory: suspendedAfter(2, []) }),
    ).rejects.toThrow(SUSPENDED);
    expect(state.account.cursor()).toBe(firstRunAt);

    await runOver(state, [lateBehindFirst, lateBehindSecond]);

    expect(state.imported.has(keyOf(lateBehindFirst))).toBe(true);
    expect(state.imported.has(keyOf(lateBehindSecond))).toBe(true);
  });

  it('reads the overlap day of a cursor 250 days stale on an account too dense to catch up in one run', async () => {
    const cursor = NOW - 250 * DAY_MS;
    const late = withdrawal({ id: 'late', applyTime: cursor - 0.5 * DAY_MS });
    const busy = Array.from({ length: 12_000 }, (_unused, index) =>
      withdrawal({ id: `busy-${index}`, applyTime: cursor + 1 + index * 1_800_000 }),
    );
    const state = await stateOf(cursor);

    const runs = await runUntilComplete(state, (attempt) =>
      attempt === 0 ? busy : [...busy, late],
    );

    expect(runs.length).toBeGreaterThan(2);
    expect(runs.at(-1)).toBe(true);
    expect(state.account.cursor()).toBe(NOW);
    expect(state.imported.has(keyOf(late))).toBe(true);
    expect(state.imported.size).toBe(busy.length + 1);
    expect(state.account.pending()).toEqual([]);
  });

  it('keeps a stopped day owed, and still reads the other owed days and the window re-scan', async () => {
    const stuckDay = { start: NOW - 300 * DAY_MS, end: NOW - 299 * DAY_MS };
    const readableDay = { start: NOW - 200 * DAY_MS, end: NOW - 199 * DAY_MS };
    const stuck = withdrawal({ id: '', txId: '', applyTime: stuckDay.start + 3_600_000 });
    const readable = withdrawal({ id: 'readable', applyTime: readableDay.start + 1 });
    const inWindow = withdrawal({ id: 'in-window', applyTime: NOW - 5 * DAY_MS });
    const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay, readableDay]);

    const first = await runOver(state, [stuck, readable, inWindow]);
    const second = await runOver(state, [stuck, readable, inWindow]);

    expect(first.result.complete).toBe(false);
    expect(state.imported.has(keyOf(readable))).toBe(true);
    expect(state.imported.has(keyOf(inWindow))).toBe(true);
    const t = stuckDay.start + 3_600_000;
    expect(state.account.pending()).toEqual([{ start: t - 1_000, end: t + 1_000, kind: 'point' }]);
    expect(second.result.complete).toBe(false);
  });

  it('asks for the owed days oldest first, after the forward pass, then the window, and reads the stuck record alone on the next run', async () => {
    const stuckDay = { start: NOW - 300 * DAY_MS, end: NOW - 299 * DAY_MS };
    const readableDay = { start: NOW - 200 * DAY_MS, end: NOW - 199 * DAY_MS };
    const stuck = withdrawal({ id: '', txId: '', applyTime: stuckDay.start + 3_600_000 });
    const state = await stateOf(NOW - 2 * DAY_MS, [readableDay, stuckDay]);

    const first = await runOver(state, [stuck]);
    const second = await runOver(state, [stuck]);

    expect(withdrawStartsOf(first.deps)).toEqual([
      NOW - 2 * DAY_MS,
      stuckDay.start,
      readableDay.start,
      NOW - 89 * DAY_MS,
    ]);
    expect((second.deps.fetchWithdrawHistory as jest.Mock).mock.calls.at(-1)?.[2]).toMatchObject({
      startTime: (stuck.applyTime as number) - 1_000,
      endTime: (stuck.applyTime as number) + 1_000,
    });
  });

  it('reads the overlap day behind an in-window re-scan mark that an absence of more than the window outran', async () => {
    const firstRunAt = NOW - 100 * DAY_MS;
    const firstCursor = firstRunAt - 2 * DAY_MS;
    const dense = Array.from({ length: 12_000 }, (_unused, index) =>
      withdrawal({
        id: `dense-${index}`,
        applyTime: firstRunAt - 88 * DAY_MS + Math.floor((index * 86 * DAY_MS) / 12_000),
      }),
    );
    const late = withdrawal({ id: 'late', applyTime: firstCursor - 0.5 * DAY_MS });
    const state = await stateOf(firstCursor);

    await runOver(state, [...dense, late], firstRunAt);

    expect(state.imported.has(keyOf(late))).toBe(false);
    expect(state.account.rescanCursor()).not.toBeNull();

    await runOver(state, [...dense, late]);

    expect(state.imported.has(keyOf(late))).toBe(true);
  });

  it('empties the list and walks from the floor after a disconnect reset the walk', async () => {
    const owed = { start: NOW - 300 * DAY_MS, end: NOW - 299 * DAY_MS };
    const reset = withWalkOwnedMetadataResetToFloor(
      {
        binanceAsset: 'BTC',
        binanceHistoryCursor: NOW,
        binanceHistoryPendingOverlap: [owed],
      },
      HISTORY_FLOOR_MS,
    );
    const state = await stateOf(
      HISTORY_FLOOR_MS,
      binanceWalkPendingOf('binanceHistoryPendingOverlap', reset),
    );

    const { deps } = await runOver(state, []);

    expect(reset?.binanceHistoryPendingOverlap).toEqual([]);
    expect(withdrawStartsOf(deps)[0]).toBe(HISTORY_FLOOR_MS);
    expect(state.account.pending()).toEqual([]);
  });

  it('drops an owed day the floor has passed, cuts one it crosses, and reads the rest', async () => {
    const passed = { start: HISTORY_FLOOR_MS - 3 * DAY_MS, end: HISTORY_FLOOR_MS - 2 * DAY_MS };
    const crossed = {
      start: HISTORY_FLOOR_MS - 0.5 * DAY_MS,
      end: HISTORY_FLOOR_MS + 0.5 * DAY_MS,
    };
    const beyond = { start: HISTORY_FLOOR_MS + 10 * DAY_MS, end: HISTORY_FLOOR_MS + 11 * DAY_MS };
    const crossedRecord = withdrawal({ id: 'crossed', applyTime: HISTORY_FLOOR_MS + 1_000 });
    const beyondRecord = withdrawal({ id: 'beyond', applyTime: beyond.start + 1_000 });
    const state = await stateOf(NOW - 2 * DAY_MS, [passed, crossed, beyond]);

    const { deps } = await runOver(state, [crossedRecord, beyondRecord]);

    expect(withdrawStartsOf(deps).every((start) => start >= HISTORY_FLOOR_MS)).toBe(true);
    expect(withdrawStartsOf(deps)).toContain(HISTORY_FLOOR_MS);
    expect(state.imported.has(keyOf(crossedRecord))).toBe(true);
    expect(state.imported.has(keyOf(beyondRecord))).toBe(true);
    expect(state.account.pending()).toEqual([]);
  });

  it('keeps a stopped day while the floor has not passed it', async () => {
    const stuckDay = { start: HISTORY_FLOOR_MS + DAY_MS, end: HISTORY_FLOOR_MS + 2 * DAY_MS };
    const stuck = withdrawal({ id: '', txId: '', applyTime: stuckDay.start + 1_000 });
    const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);

    await runOver(state, [stuck]);

    const owed = state.account.pending();
    expect(owed).toHaveLength(1);
    expect(owed[0].start).toBeGreaterThanOrEqual(stuckDay.start);
    expect(owed[0].end).toBeLessThanOrEqual(stuckDay.end);
    expect(owed[0].start).toBeLessThanOrEqual(stuckDay.start + 1_000);
    expect(owed[0].end).toBeGreaterThanOrEqual(stuckDay.start + 1_000);
  });

  it('imports nothing on a second identical run once every owed day has been read', async () => {
    const cursor = NOW - 120 * DAY_MS;
    const late = withdrawal({ id: 'late', applyTime: cursor - 0.5 * DAY_MS });
    const newer = withdrawal({ id: 'newer', applyTime: cursor + 3_600_000 });
    const state = await stateOf(cursor);
    await runUntilComplete(state, () => [late, newer]);

    const again = await runOver(state, [late, newer]);

    expect(state.imported.size).toBe(2);
    expect(again.result).toEqual({ imported: 0, complete: true });
    expect(state.account.pending()).toEqual([]);
  });

  describe('with a stored list that cannot be read', () => {
    const CURSOR = NOW - 3_600_000;
    const unreadable = () => stateOf(CURSOR, 'not a list' as unknown as WalkWindow[]);

    it('logs one fixed code and does not fail the walk', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const state = await unreadable();

      await runOver(state, []);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[binance sync] pending overlap ranges unreadable', {
        name: 'BinanceWalkStop',
        code: 'pending-malformed',
      });
    });

    it('owes all the ground from the floor to the cursor, stored before anything is read', async () => {
      const state = await unreadable();

      await runOver(state, []);

      // The first write seeds the unreadable value; the second is the run's repair of it.
      expect(state.account.writeWalkPending.mock.calls[1]).toEqual([
        'h-spot',
        'binanceHistoryPendingOverlap',
        [{ start: HISTORY_FLOOR_MS, end: CURSOR }],
      ]);
    });

    it('imports an owed record older than the window over later runs, then owes nothing', async () => {
      const old = withdrawal({ id: 'old', applyTime: NOW - 300 * DAY_MS });
      const state = await unreadable();

      const runs = await runUntilComplete(state, () => [old]);

      expect(runs.length).toBeGreaterThan(1);
      expect(runs.at(-1)).toBe(true);
      expect(state.imported.has(keyOf(old))).toBe(true);
      expect(state.account.pending()).toEqual([]);
    });
  });

  describe('with a range that has a stuck record in it', () => {
    const BASE = NOW - 300 * DAY_MS;
    const stuckDay = { start: BASE, end: BASE + DAY_MS };
    const stuckAt = stuckDay.start + 3_600_000;
    const stuckRecord = () => withdrawal({ id: '', txId: '', applyTime: stuckAt });
    const fixedRecord = () => withdrawal({ id: 'fixed', applyTime: stuckAt });
    // A withdrawal's time has a precision of one second, cut or rounded: its point is the second
    // before it, the second after it and a millisecond on each side.
    const pointAt = (time: number): OwedGround => ({
      start: time - 1_000,
      end: time + 1_000,
      kind: 'point',
    });
    // The overlap day behind the cursor lies in the window the re-scan reads; only the ground
    // older than that window is the pending pass's.
    const beyondWindow = (ranges: OwedGround[]): OwedGround[] =>
      ranges.filter((range) => range.end <= NOW - 89 * DAY_MS);

    it('imports an unrelated owed day that a merge past the twelve-range cap put beside the stuck range, and keeps only the stuck record owed at its point', async () => {
      const unrelatedDay = { start: BASE + 2.5 * DAY_MS, end: BASE + 3.5 * DAY_MS };
      const unrelated = withdrawal({ id: 'unrelated', applyTime: unrelatedDay.start });
      const others = Array.from({ length: 11 }, (_unused, index) => ({
        start: BASE - (10 + index * 10) * DAY_MS,
        end: BASE - (9 + index * 10) * DAY_MS,
      }));
      const state = await stateOf(NOW - 2 * DAY_MS, [...others, stuckDay, unrelatedDay]);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await runOver(state, [stuckRecord(), unrelated]);
      }

      expect(state.imported.has(keyOf(unrelated))).toBe(true);
      expect(state.imported.size).toBe(1);
      expect(beyondWindow(state.account.pending())).toEqual([pointAt(stuckAt)]);
    });

    it('imports a good record in the same second as the stuck one, and keeps only the stuck one owed', async () => {
      const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);

      await runOver(state, [stuckRecord(), fixedRecord()]);

      expect(state.imported).toEqual(new Set([keyOf(fixedRecord())]));
      expect(beyondWindow(state.account.pending())).toEqual([pointAt(stuckAt)]);
    });

    it('writes the rows of a read before the list that owes its stuck record', async () => {
      const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);

      const { deps } = await runOver(state, [stuckRecord(), fixedRecord()]);

      const adds = deps.addTransactions as jest.Mock;
      const listWrites = (deps.writeWalkPending as jest.Mock).mock;
      const owedAt = listWrites.calls.findIndex((call) =>
        (call[2] as WalkWindow[]).some((range) => range.start === stuckAt - 1_000),
      );
      expect(adds.mock.invocationCallOrder[0]).toBeLessThan(listWrites.invocationCallOrder[owedAt]);
    });

    it('re-scans the records after a stuck one in the same run, and owes the stuck record at its point', async () => {
      const stuckInWindow = withdrawal({ id: '', txId: '', applyTime: NOW - 10 * DAY_MS });
      const later = withdrawal({ id: 'later', applyTime: NOW - 5 * DAY_MS });
      const earlier = withdrawal({ id: 'earlier', applyTime: NOW - 20 * DAY_MS });
      const state = await stateOf(NOW - 2 * DAY_MS);

      const { result } = await runOver(state, [earlier, stuckInWindow, later]);

      expect(state.imported).toEqual(new Set([keyOf(earlier), keyOf(later)]));
      expect(state.account.pending()).toEqual([pointAt(NOW - 10 * DAY_MS)]);
      expect(result.complete).toBe(false);
    });

    describe('with a new owed range behind stuck ranges that are older', () => {
      const stuckRangesOf = (count: number): WalkWindow[] =>
        Array.from({ length: count }, (_unused, index) => ({
          start: BASE + index * 10 * DAY_MS,
          end: BASE + index * 10 * DAY_MS + DAY_MS,
        }));
      const newDay = { start: BASE + 150 * DAY_MS, end: BASE + 151 * DAY_MS };
      const stuckRecordsOf = (ranges: WalkWindow[]) =>
        ranges.map((range, index) =>
          withdrawal({ id: '', txId: '', applyTime: range.start + 1_000 + index }),
        );
      const fresh = () => withdrawal({ id: 'new-day', applyTime: newDay.start + 1_000 });

      it.each([2, 6])(
        'reads it on the first run behind %i of them, and reads the re-scan in that run',
        async (count) => {
          const stuckRanges = stuckRangesOf(count);
          const state = await stateOf(NOW - 2 * DAY_MS, [...stuckRanges, newDay]);

          const { deps } = await runOver(state, [...stuckRecordsOf(stuckRanges), fresh()]);

          expect(state.imported.has(keyOf(fresh()))).toBe(true);
          expect(withdrawStartsOf(deps)).toContain(NOW - 89 * DAY_MS);
        },
      );
    });

    describe('with ten spans that cannot be halved any further, left by isolating ten stuck days', () => {
      const stuckDays = Array.from({ length: 10 }, (_unused, index) => ({
        start: BASE + index * 10 * DAY_MS,
        end: BASE + index * 10 * DAY_MS + DAY_MS,
      }));
      const stuckTimes = stuckDays.map((day, index) => day.start + 3_600_000 + index);
      const stuckRecords = () =>
        stuckTimes.map((applyTime) => withdrawal({ id: '', txId: '', applyTime }));
      const fixedRecords = () =>
        stuckTimes.map((applyTime, index) => withdrawal({ id: `fixed-${index}`, applyTime }));
      const newDay = { start: BASE + 150 * DAY_MS, end: BASE + 151 * DAY_MS };
      const fresh = () => withdrawal({ id: 'new-day', applyTime: newDay.start + 1_000 });
      const late = () => withdrawal({ id: 'late', applyTime: NOW - 50 * DAY_MS });
      const isolatedOwed = (state: PendingState): OwedGround[] =>
        beyondWindow(state.account.pending()).filter((range) => range.kind === 'point');
      const isolatedSpans = stuckTimes.map(pointAt);

      const stateWithIsolated = () => stateOf(NOW - 2 * DAY_MS, [...isolatedSpans, newDay]);

      it('owes each stuck day at its record alone once the runs have read every day, and imports the rest of each', async () => {
        const state = await stateOf(NOW - 2 * DAY_MS, stuckDays);

        // A run reads as many days as its capital calls allow: three runs read the ten.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await runOver(state, [...stuckRecords(), ...fixedRecords()]);
        }

        expect(beyondWindow(state.account.pending())).toEqual(isolatedSpans);
        expect(state.imported.size).toBe(10);
      });

      it('imports the new owed day and the late record of the window on the next run, and keeps the spans owed', async () => {
        const state = await stateWithIsolated();

        await runOver(state, [...stuckRecords(), fresh(), late()]);

        expect(state.imported.has(keyOf(fresh()))).toBe(true);
        expect(state.imported.has(keyOf(late()))).toBe(true);
        expect(state.imported.size).toBe(2);
        expect(isolatedOwed(state)).toHaveLength(10);
        expect(
          beyondWindow(state.account.pending()).some((range) => range.start === newDay.start),
        ).toBe(false);
      });

      it('reads the new owed day and the re-scan before any of the spans, in one run', async () => {
        const state = await stateWithIsolated();

        const { deps } = await runOver(state, [...stuckRecords(), fresh(), late()]);

        const starts = withdrawStartsOf(deps);
        expect(starts.indexOf(newDay.start)).toBeGreaterThan(0);
        expect(starts.indexOf(newDay.start)).toBeLessThan(starts.indexOf(isolatedSpans[0].start));
        expect(starts.indexOf(NOW - 89 * DAY_MS)).toBeLessThan(
          starts.indexOf(isolatedSpans[0].start),
        );
      });

      it('imports a span that became readable on a later run once budget is left, and nothing twice', async () => {
        const state = await stateWithIsolated();
        await runOver(state, [...stuckRecords(), fresh(), late()]);

        for (let attempt = 0; attempt < 10; attempt += 1) {
          await runOver(state, [...fixedRecords(), fresh(), late()]);
        }

        expect(state.imported.size).toBe(12);
        expect(beyondWindow(state.account.pending())).toEqual([]);

        const again = await runOver(state, [...fixedRecords(), fresh(), late()]);

        expect(again.result).toEqual({ imported: 0, complete: true });
      });

      it('imports nothing on a second run over the same stuck records', async () => {
        const state = await stateWithIsolated();
        await runOver(state, [...stuckRecords(), fresh(), late()]);

        const second = await runOver(state, [...stuckRecords(), fresh(), late()]);

        expect(second.result).toEqual({ imported: 0, complete: false });
        expect(state.imported.size).toBe(2);
        expect(isolatedOwed(state)).toHaveLength(10);
      });
    });

    it('owes the stuck range at its record alone after the first run, and reads only that point from then on', async () => {
      const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);

      await runOver(state, [stuckRecord()]);
      const owedAfterFirst = beyondWindow(state.account.pending());

      const second = await runOver(state, [stuckRecord()]);

      expect(owedAfterFirst).toEqual([pointAt(stuckAt)]);
      expect(beyondWindow(state.account.pending())).toEqual(owedAfterFirst);
      expect(withdrawStartsOf(second.deps).filter((start) => start < NOW - 89 * DAY_MS)).toEqual([
        stuckAt - 1_000,
      ]);
    });

    it('imports the stuck record once it can be placed, and a later identical run imports nothing', async () => {
      const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);

      for (let attempt = 0; attempt < 40; attempt += 1) {
        await runOver(state, [stuckRecord()]);
      }

      expect(state.imported.size).toBe(0);

      const fixed = await runOver(state, [fixedRecord()]);
      const again = await runOver(state, [fixedRecord()]);

      expect(fixed.result.imported).toBe(1);
      expect(state.imported.has(keyOf(fixedRecord()))).toBe(true);
      expect(state.account.pending()).toEqual([]);
      expect(again.result).toEqual({ imported: 0, complete: true });
    });

    it('owes a stuck deposit at its millisecond and one on each side, beside a withdrawal at its second', async () => {
      const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);
      const stuckDeposit = deposit({ id: '', txId: '', insertTime: stuckAt + 5_000 });
      const fixedDeposit = deposit({ id: 'fixed-deposit', insertTime: stuckAt + 5_000 });

      await runOver(state, [stuckRecord()], NOW, {
        fetchDepositHistory: depositServer([stuckDeposit, fixedDeposit]),
      });

      expect(state.imported).toEqual(new Set([`${ACCOUNT}:deposit:fixed-deposit`]));
      expect(beyondWindow(state.account.pending())).toEqual([
        pointAt(stuckAt),
        { start: stuckAt + 4_999, end: stuckAt + 5_001, kind: 'point' },
      ]);
    });

    describe('while the forward pass stops at a record it cannot trust, in every run', () => {
      const CURSOR = NOW - 2 * DAY_MS;
      const forwardStuck = () => withdrawal({ id: '', txId: '', applyTime: NOW - 3_600_000 });
      const repaired = () => withdrawal({ id: 'repaired', applyTime: stuckAt });

      it('goes on to the owed day and the window re-scan, and the cursor stays', async () => {
        const state = await stateOf(CURSOR, [stuckDay]);

        const { deps, result } = await runOver(state, [
          forwardStuck(),
          stuckRecord(),
          fixedRecord(),
        ]);

        expect(state.imported).toEqual(new Set([keyOf(fixedRecord())]));
        expect(state.account.cursor()).toBe(CURSOR);
        expect(withdrawStartsOf(deps)).toContain(NOW - 89 * DAY_MS);
        expect(beyondWindow(state.account.pending())).toEqual([pointAt(stuckAt)]);
        expect(result.complete).toBe(false);
      });

      it('reads the points in the next run: a record that settles meanwhile imports, and the cursor stays', async () => {
        const state = await stateOf(CURSOR, [stuckDay]);
        await runOver(state, [forwardStuck(), stuckRecord()]);

        const second = await runOver(state, [forwardStuck(), repaired()]);

        expect(state.imported).toEqual(new Set([keyOf(repaired())]));
        expect(withdrawStartsOf(second.deps)).toContain(stuckAt - 1_000);
        expect(withdrawStartsOf(second.deps)).toContain(NOW - 89 * DAY_MS);
        expect(beyondWindow(state.account.pending())).toEqual([]);
        expect(state.account.cursor()).toBe(CURSOR);
      });
    });

    describe('with a row the client could not read (R30)', () => {
      const STOP_TAG = '[binance sync] history window stopped';
      const UNREADABLE_CODE = 'capital-row-unreadable';
      const goodDeposit = () => deposit({ id: 'good', insertTime: stuckAt });
      const goodWithdrawal = () => withdrawal({ id: 'good-w', applyTime: stuckAt + 5_000 });
      const depositKey = `${ACCOUNT}:deposit:good`;
      const stuckAtText = new Date(stuckAt).toISOString().slice(0, 19).replace('T', ' ');
      let warn: jest.SpyInstance;

      beforeEach(() => {
        warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      });

      afterEach(() => {
        warn.mockRestore();
      });

      const timeOf = (row: UnreadableRow): number | undefined =>
        typeof row.time === 'string' ? parseWithdrawTime(row.time) : row.time;

      /** A read that also reports the unreadable rows in the span (all those with no time). */
      const reporting = <Row>(
        serve: (apiKey: string, secret: string, window: HistoryWindow) => Promise<HistoryPage<Row>>,
        unreadable: UnreadableRow[],
      ) =>
        jest.fn(async (apiKey: string, secret: string, window: HistoryWindow) => ({
          ...(await serve(apiKey, secret, window)),
          unreadable:
            window.offset > 0
              ? []
              : unreadable.filter((row) => {
                  const time = timeOf(row);

                  return time === undefined || (time >= window.startTime && time <= window.endTime);
                }),
        }));

      const loggedCodes = (): string[] => warn.mock.calls.map(([, detail]) => detail.code);

      it('imports the readable deposit of an owed day and owes the unreadable one at its own point, logging only the code', async () => {
        const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);

        const { result } = await runOver(state, [], NOW, {
          fetchDepositHistory: reporting(depositServer([goodDeposit()]), [{ time: stuckAt }]),
        });

        expect(state.imported).toEqual(new Set([depositKey]));
        expect(beyondWindow(state.account.pending())).toEqual([
          { start: stuckAt - 1, end: stuckAt + 1, kind: 'point' },
        ]);
        expect(warn.mock.calls).toEqual([
          [STOP_TAG, { name: 'BinanceWalkStop', code: UNREADABLE_CODE }],
        ]);
        expect(result.complete).toBe(false);
      });

      it.each([
        ['text', stuckAtText],
        ['epoch milliseconds', stuckAt],
      ])(
        'owes an unreadable withdrawal whose applyTime is %s at the second it may sit in',
        async (_label, applyTime) => {
          const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);

          await runOver(state, [goodWithdrawal()], NOW, {
            fetchWithdrawHistory: reporting(withdrawalServer([goodWithdrawal()]), [
              { time: applyTime },
            ]),
          });

          expect(state.imported).toEqual(new Set([keyOf(goodWithdrawal())]));
          expect(beyondWindow(state.account.pending())).toEqual([pointAt(stuckAt)]);
          expect(loggedCodes()).toEqual([UNREADABLE_CODE]);
        },
      );

      it('owes the whole span of a row with no usable time, and imports the other rows of it', async () => {
        const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);

        await runOver(state, [], NOW, {
          fetchDepositHistory: reporting(depositServer([goodDeposit()]), [{ time: undefined }]),
        });

        expect(state.imported).toEqual(new Set([depositKey]));
        expect(beyondWindow(state.account.pending())).toEqual([stuckDay]);
        expect(loggedCodes()).toContain(UNREADABLE_CODE);
      });

      it('owes the point of an unreadable row of the re-scan window, and imports the rows around it', async () => {
        const unreadableAt = NOW - 10 * DAY_MS;
        const state = await stateOf(NOW - 2 * DAY_MS);
        const later = deposit({ id: 'later', insertTime: NOW - 5 * DAY_MS });

        const { result } = await runOver(state, [], NOW, {
          fetchDepositHistory: reporting(depositServer([later]), [{ time: unreadableAt }]),
        });

        expect(state.imported).toEqual(new Set([`${ACCOUNT}:deposit:later`]));
        expect(state.account.pending()).toEqual([
          { start: unreadableAt - 1, end: unreadableAt + 1, kind: 'point' },
        ]);
        expect(result.complete).toBe(false);
      });

      it('stops the forward pass like any other stop: the cursor stays, and the owed day is still read', async () => {
        const cursor = NOW - 2 * DAY_MS;
        const state = await stateOf(cursor, [stuckDay]);

        const { result } = await runOver(state, [], NOW, {
          fetchDepositHistory: reporting(depositServer([goodDeposit()]), [
            { time: NOW - 3_600_000 },
          ]),
        });

        expect(state.account.cursor()).toBe(cursor);
        expect(state.imported).toEqual(new Set([depositKey]));
        expect(result.complete).toBe(false);
      });

      it('counts an unreadable row toward a full page, so a page of rows and unreadable ones is read in halves', async () => {
        const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);
        const fullByOne = jest.fn(
          async (_apiKey: string, _secret: string, window: HistoryWindow) => ({
            ...historyPage(
              window.endTime - window.startTime > DAY_MS / 2
                ? Array.from({ length: HISTORY_PAGE_LIMIT - 1 }, (_unused, index) =>
                    deposit({ id: `d${index}`, insertTime: window.startTime }),
                  )
                : [],
            ),
            unreadable: window.endTime - window.startTime > DAY_MS / 2 ? [{ time: undefined }] : [],
          }),
        );

        await runOver(state, [], NOW, { fetchDepositHistory: fullByOne });

        const dayCalls = fullByOne.mock.calls
          .map((call) => call[2])
          .filter((window) => window.startTime === stuckDay.start);
        expect(dayCalls[0].endTime).toBe(stuckDay.end);
        expect(dayCalls[1].endTime).toBe(stuckDay.start + DAY_MS / 2);
      });

      it('never rejects the run for a row, and writes the rows of the span before the list that owes it', async () => {
        const state = await stateOf(NOW - 2 * DAY_MS, [stuckDay]);

        const { deps } = await runOver(state, [], NOW, {
          fetchDepositHistory: reporting(depositServer([goodDeposit()]), [{ time: stuckAt }]),
        });

        const listWrites = (deps.writeWalkPending as jest.Mock).mock;
        const owedAt = listWrites.calls.findIndex((call) =>
          (call[2] as WalkWindow[]).some((range) => range.start === stuckAt - 1),
        );
        expect((deps.addTransactions as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
          listWrites.invocationCallOrder[owedAt],
        );
      });
    });

    describe('with two points that start together, a withdrawal second and a deposit inside it', () => {
      const withdrawalPoint = pointAt(stuckAt);
      const depositAt = stuckAt - 999;
      const depositPoint: OwedGround = { start: depositAt - 1, end: depositAt + 1, kind: 'point' };

      it('takes off only the narrower, the deposit point, when the read of the wider returned the deposit alone', async () => {
        const state = await stateOf(NOW - 2 * DAY_MS, [depositPoint, withdrawalPoint]);
        const fixedDeposit = deposit({ id: 'fixed-deposit', insertTime: depositAt });

        await runOver(state, [], NOW, { fetchDepositHistory: depositServer([fixedDeposit]) });

        expect(state.imported).toEqual(new Set([`${ACCOUNT}:deposit:fixed-deposit`]));
        expect(beyondWindow(state.account.pending())).toEqual([withdrawalPoint]);
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
        times.map((applyTime) => withdrawal({ id: '', txId: '', applyTime }));
      const pointStartsOf = (deps: BinanceTransactionSyncDeps) =>
        withdrawStartsOf(deps).filter((start) => points.some((point) => point.start === start));

      it('stores the start of the point it read, after the list write of that point', async () => {
        const state = await stateOf(CURSOR, [stuckDay]);
        await runOver(state, [stuckRecord()]);

        const { deps } = await runOver(state, [fixedRecord()]);

        const cursorWrites = deps.writeWalkCursor as jest.Mock;
        const pointWriteAt = cursorWrites.mock.calls.findIndex(
          (call) => call[1] === 'binanceHistoryPointCursor',
        );
        const lastListWrite = Math.max(
          ...(deps.writeWalkPending as jest.Mock).mock.invocationCallOrder,
        );
        expect(cursorWrites.mock.calls[pointWriteAt][2]).toBe(stuckAt - 1_000);
        expect(cursorWrites.mock.invocationCallOrder[pointWriteAt]).toBeGreaterThan(lastListWrite);
        expect(state.account.pointCursor()).toBe(stuckAt - 1_000);
      });

      it('reads the points after the stored cursor first, then wraps around to the ones before', async () => {
        const state = await stateOf(CURSOR, points);
        await state.account.writeWalkCursor('h-spot', 'binanceHistoryPointCursor', points[0].start);

        const { deps } = await runOver(state, stuckAtEach());

        expect(pointStartsOf(deps)).toEqual([points[1].start, points[2].start, points[0].start]);
        expect(state.account.pointCursor()).toBe(points[0].start);
      });

      it('starts at the oldest point, with one fixed log code, when the stored cursor is no number', async () => {
        const state = await stateOf(CURSOR, points);
        await state.account.writeWalkCursor('h-spot', 'binanceHistoryPointCursor', Number.NaN);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        const { deps } = await runOver(state, stuckAtEach());

        expect(pointStartsOf(deps)).toEqual(points.map((point) => point.start));
        expect(warn.mock.calls).toContainEqual([
          '[binance sync] point cursor unreadable',
          { name: 'BinanceWalkStop', code: 'point-cursor-malformed' },
        ]);
      });
    });
  });

  describe('the range cursor and the span hints of the round-robin', () => {
    const CURSOR = NOW - 2 * DAY_MS;
    const BASE = NOW - 300 * DAY_MS;
    const dayAt = (index: number): OwedGround => ({
      start: BASE + index * 10 * DAY_MS,
      end: BASE + index * 10 * DAY_MS + DAY_MS,
    });
    const days = [dayAt(0), dayAt(1), dayAt(2)];
    const RANGE_FIELD = 'binanceHistoryRangeCursor';
    const HINTS_FIELD = 'binanceHistorySpanHints';
    const dayStartsOf = (deps: BinanceTransactionSyncDeps): number[] =>
      withdrawStartsOf(deps).filter((start) => days.some((day) => day.start === start));

    /** A run that affords `cap` requests for withdrawals (the mock counts them), and no more. */
    const runWithWithdrawals = (cap: number, requests: jest.Mock) => ({
      gate: freshRun().gate,
      budget: {
        canAfford: () => requests.mock.calls.length < cap,
        record: () => undefined,
      },
    });

    it('reads the owed days that start after the stored range cursor first, then wraps around', async () => {
      const state = await stateOf(CURSOR, days);
      await state.account.writeWalkCursor('h-spot', RANGE_FIELD, days[0].end);

      const { deps } = await runOver(state, []);

      expect(dayStartsOf(deps)).toEqual([days[1].start, days[2].start, days[0].start]);
    });

    it('stores the end of the window of the last day it read, once each read has started', async () => {
      const state = await stateOf(CURSOR, days);

      const { deps } = await runOver(state, []);

      const writes = (deps.writeWalkCursor as jest.Mock).mock.calls.filter(
        (call) => call[1] === RANGE_FIELD,
      );
      expect(writes.map((call) => call[2])).toEqual(days.map((day) => day.end));
      expect(state.account.rangeCursor()).toBe(days[2].end);
    });

    it('starts at the oldest day, with one fixed log code, when the stored cursor is no number', async () => {
      const state = await stateOf(CURSOR, days);
      await state.account.writeWalkCursor('h-spot', RANGE_FIELD, Number.NaN);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const { deps } = await runOver(state, []);

      expect(dayStartsOf(deps)).toEqual(days.map((day) => day.start));
      expect(warn.mock.calls).toContainEqual([
        '[binance sync] range cursor unreadable',
        { name: 'BinanceWalkStop', code: 'range-cursor-malformed' },
      ]);
    });

    it('stores the span a day was left at when its halving chain is cut short, and begins with it in the next run', async () => {
      const day = days[0];
      const fullPage = Array.from({ length: HISTORY_PAGE_LIMIT }, (_unused, index) =>
        withdrawal({ id: `w${index}`, applyTime: day.start + 1_000 }),
      );
      const denseDay = () =>
        jest.fn(async (_apiKey: string, _secret: string, window: HistoryWindow) =>
          window.startTime === day.start && window.endTime - window.startTime > DAY_MS / 4
            ? historyPage(fullPage)
            : historyPage([]),
        );
      const state = await stateOf(CURSOR, [day]);
      const requests = denseDay();
      const first = makeFirstSyncDeps(state.account, { fetchWithdrawHistory: requests });

      // The forward window, then the day (too full), then its half (too full): no request is left
      // for the half of that.
      await sync(first, ACCOUNT, runWithWithdrawals(3, requests));

      expect(state.account.hints()?.pending).toEqual([
        { start: day.start, end: day.start + DAY_MS / 4 },
      ]);
      expect(state.account.hints()?.forward).toEqual([]);

      const second = makeFirstSyncDeps(state.account, { fetchWithdrawHistory: denseDay() });

      await sync(second, ACCOUNT, freshRun());

      const firstOfDay = (second.fetchWithdrawHistory as jest.Mock).mock.calls
        .map((call) => call[2] as HistoryWindow)
        .find((window) => window.startTime === day.start);
      expect(firstOfDay?.endTime).toBe(day.start + DAY_MS / 4);
      expect(state.account.hints()?.pending).toEqual([]);
    });

    it('stores a malformed hint over with none, logging one fixed code, and reads the whole window', async () => {
      const state = await stateOf(CURSOR, [days[0]]);
      await state.account.writeWalkHints(
        'h-spot',
        HINTS_FIELD,
        'soon' as unknown as BinanceSpanHints,
      );
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const { deps } = await runOver(state, []);

      expect(warn.mock.calls).toContainEqual([
        '[binance sync] span hints unreadable',
        { name: 'BinanceWalkStop', code: 'span-hints-malformed' },
      ]);
      expect(state.account.hints()).toEqual({ forward: [], pending: [], rescan: [], point: [] });
      expect(
        (deps.fetchWithdrawHistory as jest.Mock).mock.calls
          .map((call) => call[2] as HistoryWindow)
          .find((window) => window.startTime === days[0].start)?.endTime,
      ).toBe(days[0].end);
    });
  });

  it('asks for nothing more after a rate limit hit in an owed day', async () => {
    const owed = { start: NOW - 300 * DAY_MS, end: NOW - 299 * DAY_MS };
    const another = { start: NOW - 200 * DAY_MS, end: NOW - 199 * DAY_MS };
    const state = await stateOf(NOW - 2 * DAY_MS, [owed, another]);
    const fetchWithdrawHistory = jest
      .fn()
      .mockResolvedValueOnce(historyPage([]))
      .mockRejectedValue(new BinanceRateLimitError(429, 60_000));

    const { result } = await runOver(state, [], NOW, { fetchWithdrawHistory });

    expect(result.complete).toBe(false);
    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(2);
    expect(state.account.pending()).toEqual([
      owed,
      another,
      { start: NOW - 3 * DAY_MS, end: NOW - 2 * DAY_MS },
    ]);
  });
});
