import { DAY_MS } from '@kiko/dates';
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
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';

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
  usedUidWeight1m,
  usedIpWeight1m,
});

// A typed, empty deposit-history mock. The explicit params type `mock.calls[n][2]`
// as the HistoryWindow so the window-walk assertions read it without a cast.
const emptyDepositFetch = () =>
  jest.fn(async (_apiKey: string, _secret: string, _window: HistoryWindow) => historyPage([]));

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

const addedRows = (deps: BinanceTransactionSyncDeps, call = 0): BinanceTransactionRow[] =>
  (deps.addTransactions as jest.Mock).mock.calls[call][0] as BinanceTransactionRow[];

/**
 * A stateful Spot holding + `writeWalkCursor` pair for a multi-run test:
 * each run's `listHoldings` reads whatever the LAST run's `writeWalkCursor`
 * wrote, so a resumed run genuinely picks up from where the prior one left off.
 */
const makeStatefulSpotAccount = (): {
  listHoldings: () => Promise<HoldingRow[]>;
  writeWalkCursor: jest.Mock<Promise<void>, [string, string, number]>;
  cursor: () => number | null;
} => {
  let cursor: number | null = null;

  return {
    listHoldings: async () => [
      {
        id: 'h-spot',
        metadata:
          cursor === null
            ? { binanceAsset: 'BTC' }
            : { binanceAsset: 'BTC', binanceHistoryCursor: cursor },
      } as unknown as HoldingRow,
    ],
    writeWalkCursor: jest.fn(async (_holdingId: string, _field: string, cursorMs: number) => {
      cursor = cursorMs;
    }),
    cursor: () => cursor,
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
    latestTransactionTime: async () => undefined,
    ...over,
  });

/** A full deposit page, the length at which the walk asks for the next page. */
const fullDepositPage = (): BinanceDeposit[] =>
  Array.from({ length: HISTORY_PAGE_LIMIT }, (_unused, index) => deposit({ id: `d${index}` }));

/** The end of the first of the three 89-day windows a cursor 200 days back is walked in. */
const FIRST_OF_THREE_WINDOWS_END = NOW - 201 * DAY_MS + 89 * DAY_MS;

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
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit()])),
      fetchWithdrawHistory: jest.fn(async () => historyPage([withdrawal()])),
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
    const deps = makeDeps({ latestTransactionTime: async () => NOW - 10 * DAY_MS });

    await sync(deps);

    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(1);
    expect(deps.writeWalkCursor).toHaveBeenCalledWith('h-spot', 'binanceHistoryCursor', NOW);
  });

  it('paces the two endpoint requests in a window through the shared run gate', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    // A recent cursor keeps the walk to ONE 89-day window: a deposit request then
    // a withdraw request, two requests total.
    const deps = makeDeps({ latestTransactionTime: async () => NOW - 10 * DAY_MS });

    await sync(deps, ACCOUNT_ID, freshRun(deps.now, sleep));

    // The first request fires immediately; the second waits the pacing interval,
    // so the two are not fired back-to-back.
    expect(sleep).toHaveBeenCalledTimes(1);
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
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
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

  it('offset-pages within a window until a short page, collecting every row', async () => {
    const fetchDepositHistory = jest.fn(
      async (_key: string, _secret: string, window: HistoryWindow) =>
        historyPage(window.offset === 0 ? fullDepositPage() : [deposit({ id: 'last' })]),
    );
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory,
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: HISTORY_PAGE_LIMIT + 1, complete: true });
    expect(fetchDepositHistory).toHaveBeenCalledTimes(2);
    expect(fetchDepositHistory.mock.calls[0][2].offset).toBe(0);
    expect(fetchDepositHistory.mock.calls[1][2].offset).toBe(HISTORY_PAGE_LIMIT);
  });

  it('re-sync from a recent cursor scans exactly the last 89-day window', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory,
    });

    await sync(deps);

    expect(fetchDepositHistory).toHaveBeenCalledTimes(1);
    const window = fetchDepositHistory.mock.calls[0][2];
    expect(window.startTime).toBe(NOW - 89 * DAY_MS);
    expect(window.endTime).toBe(NOW);
  });

  it('walks contiguous windows back to a cursor older than one window', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    // A cursor 200 days back: overlap widens the start to 201 days, spanning
    // three 89-day windows (89 + 89 + 23).
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 200 * DAY_MS,
      fetchDepositHistory,
    });

    await sync(deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows).toHaveLength(3);
    expect(windows[0].startTime).toBe(NOW - 201 * DAY_MS);
    expect(windows[2].endTime).toBe(NOW);
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
    expect(windows).toHaveLength(1);
    expect(windows[0].startTime).toBe(NOW - 89 * DAY_MS);
    expect(windows[0].endTime).toBe(NOW);
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
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory,
    });

    await sync(deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows[0].startTime).toBe(HISTORY_FLOOR_MS);
  });

  it('imports nothing but still advances the watermark when the window holds no settled records', async () => {
    const deps = makeDeps({ latestTransactionTime: async () => NOW - 10 * DAY_MS });

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
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
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
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(1);
    expect(deps.writeWalkCursor).toHaveBeenCalledWith(
      'h-spot',
      'binanceHistoryCursor',
      FIRST_OF_THREE_WINDOWS_END,
    );
  });

  it('keys the same record identically across runs so a re-sync dedupes', async () => {
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
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
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ id: '7' })])),
    });
    const depsB = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ id: '7' })])),
    });

    await sync(depsA, 'acc-a');
    await sync(depsB, 'acc-b');

    expect(addedRows(depsA)[0].externalId).toBe('acc-a:deposit:7');
    expect(addedRows(depsB)[0].externalId).toBe('acc-b:deposit:7');
  });
});

// A recent cursor keeps each case to one 89-day window.
const RECENT_CURSOR = async () => NOW - 10 * DAY_MS;

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
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ walletType: 1 })])),
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
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ walletType: 1 })])),
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
      fetchDepositHistory: jest.fn(async () =>
        historyPage([deposit({ walletType: 1 }), deposit({ id: '8', walletType: 1 })]),
      ),
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
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ walletType: 1 })])),
    });

    await sync(deps);

    expect(order).toEqual(['ensureHoldings', 'addTransactions', 'writeWalkCursor']);
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
    fetchDepositHistory: jest.fn(async () =>
      historyPage([deposit(), deposit({ id: '2', ...over })]),
    ),
  });

  const badWithdrawal = (
    over: Partial<BinanceWithdrawal>,
  ): Partial<BinanceTransactionSyncDeps> => ({
    fetchWithdrawHistory: jest.fn(async () => historyPage([withdrawal({ id: '2', ...over })])),
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
      fetchDepositHistory: jest.fn(async () =>
        historyPage([
          deposit({ id: '', txId: '', amount: 'abc', status: 0, walletType: 7 }),
          deposit({ id: '3' }),
        ]),
      ),
      fetchWithdrawHistory: jest.fn(async () =>
        historyPage([withdrawal({ id: '', txId: '', amount: 'abc', applyTime: 'x', status: 3 })]),
      ),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 1, complete: true });
    expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:deposit:3']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the earlier window committed and its cursor when a later window stops', async () => {
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

    expect(result).toEqual({ imported: 1, complete: false });
    expect(deps.addTransactions).toHaveBeenCalledTimes(1);
    expect(deps.writeWalkCursor).toHaveBeenCalledTimes(1);
    expect(deps.writeWalkCursor).toHaveBeenCalledWith(
      'h-spot',
      'binanceHistoryCursor',
      FIRST_OF_THREE_WINDOWS_END,
    );
  });

  it('stops when the placement holding is still absent after it was created', async () => {
    const deps = makeDeps({
      latestTransactionTime: RECENT_CURSOR,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit({ walletType: 1 })])),
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

  it('a deposit page that leaves room for exactly one more IP weight lets the window continue', async () => {
    const fetchDepositHistory = jest.fn(
      async (_key: string, _secret: string, window: HistoryWindow) =>
        window.offset === 0 ? historyPage(fullDepositPage(), undefined, 5_999) : historyPage([]),
    );
    const deps = makeDeps({ latestTransactionTime: RECENT_CURSOR, fetchDepositHistory });

    const result = await sync(deps, 'acc-ip-room');

    expect(fetchDepositHistory).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ imported: HISTORY_PAGE_LIMIT, complete: true });
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
    const deps = makeDeps({
      listHoldings: account.listHoldings,
      writeWalkCursor,
      addTransactions,
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => historyPage([deposit()])),
      fetchWithdrawHistory: jest.fn(async () => historyPage([])),
    });

    await sync(deps, 'acc-crash-order');

    expect(invocationCallOrder).toEqual(['addTransactions', 'writeWalkCursor']);
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
