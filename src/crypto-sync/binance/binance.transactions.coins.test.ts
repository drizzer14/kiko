import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { coinListPatchesOf, walkMarkWritesOf, walkStateFake } from '@kiko/test-support/walk-marks';

import {
  type BinanceTransactionRow,
  type BinanceTransactionSyncDeps,
  HISTORY_FLOOR_MS,
  syncBinanceTransactions,
} from './binance.transactions';
import {
  type BinanceDeposit,
  type BinanceUntrackedRecord,
  type BinanceWithdrawal,
  type CapitalPage,
  fetchDepositHistory,
  fetchWithdrawHistory,
  HISTORY_PAGE_LIMIT,
  type HistoryWindow,
} from './binance.history-client';
import { createBinanceHistoryRun } from './binance.history-budget';

const NOW = 1_704_326_400_000; // 2024-01-04T00:00:00Z
const ACCOUNT_ID = 'acc-1';
const STOP_TAG = '[binance sync] history window stopped';

const spotHolding = { id: 'h-spot', metadata: { binanceAsset: 'BTC' } } as unknown as HoldingRow;
const fundingHolding = {
  id: 'h-funding',
  metadata: { binanceAsset: 'BTC:funding' },
} as unknown as HoldingRow;

// The walk never reads the hash of a record that has an id, so the fixtures leave it out.
const deposit = (over: Partial<BinanceDeposit> = {}): BinanceDeposit =>
  ({
    id: '1',
    amount: '0.5',
    coin: 'BTC',
    insertTime: NOW - DAY_MS,
    status: 1,
    walletType: undefined,
    ...over,
  }) as BinanceDeposit;

const withdrawal = (over: Partial<BinanceWithdrawal> = {}): BinanceWithdrawal =>
  ({
    id: '9',
    amount: '0.25',
    transactionFee: '0.0001',
    coin: 'BTC',
    applyTime: '2024-01-03 00:00:00',
    status: 6,
    walletType: undefined,
    ...over,
  }) as BinanceWithdrawal;

const historyPage = <Row>(
  rows: Row[],
  untracked: BinanceUntrackedRecord[] = [],
): CapitalPage<Row> => ({
  rows,
  unreadable: [],
  untracked,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
});

/** A record of a coin the walk does not track, as the client reports it (settled by default). */
const untrackedRecord = (over: Partial<BinanceUntrackedRecord> = {}): BinanceUntrackedRecord => ({
  ticker: 'PEPE',
  status: 1,
  time: NOW - DAY_MS,
  ...over,
});

/** The same for a withdrawal: settled is status 6, and its time is a datetime text. */
const untrackedWithdrawal = (over: Partial<BinanceUntrackedRecord> = {}) =>
  untrackedRecord({ status: 6, time: '2024-01-03 00:00:00', ...over });

/** A history that holds `rows` only in a span ending at now, so no span behind it reads any. */
const rowsAtNow = <Row>(rows: Row[], untracked: BinanceUntrackedRecord[] = []) =>
  jest.fn(async (_apiKey: string, _secret: string, window: HistoryWindow) =>
    window.endTime === NOW ? historyPage(rows, untracked) : historyPage([]),
  );

/** The holdings a walk creates are listed by the next read, as a real store lists them. */
const creatingStore = (initial: HoldingRow[] = [spotHolding]) => {
  let stored = initial;
  const ensureHoldings = jest.fn(async (holdings: { metadataKey: string }[]) => {
    stored = [
      ...stored,
      ...holdings.map(
        ({ metadataKey }) =>
          ({
            id: `h-${metadataKey}`,
            metadata: { binanceAsset: metadataKey },
          }) as unknown as HoldingRow,
      ),
    ];
  });

  return { ensureHoldings, listHoldings: async () => stored };
};

const makeDeps = (over: Partial<BinanceTransactionSyncDeps> = {}): BinanceTransactionSyncDeps => ({
  now: () => NOW,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  listHoldings: async () => [spotHolding],
  ensureHoldings: jest.fn(async () => undefined),
  storedExternalIds: jest.fn(async () => new Set<string>()),
  latestTransactionTime: async () => undefined,
  addTransactions: jest.fn(async (rows: BinanceTransactionRow[]) => rows.length),
  ...walkStateFake({ accountId: ACCOUNT_ID, marks: { capital: { cursor: NOW - 3 * DAY_MS } } })
    .deps,
  fetchDepositHistory: jest.fn(async () => historyPage([])),
  fetchWithdrawHistory: jest.fn(async () => historyPage([])),
  ...over,
});

const sync = (deps: BinanceTransactionSyncDeps) =>
  syncBinanceTransactions(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: deps.now, sleep: async () => undefined }),
    },
    deps,
  );

const addedRows = (deps: BinanceTransactionSyncDeps): BinanceTransactionRow[] =>
  (deps.addTransactions as jest.Mock).mock.calls.flatMap((call) => call[0]);

describe('capital rows of every tracked coin', () => {
  it.each([
    ['a Spot deposit', { walletType: 0 }, 'USDT', 'Binance Spot · USDT', 'h-USDT'],
    ['a deposit with no walletType', {}, 'USDT', 'Binance Spot · USDT', 'h-USDT'],
    [
      'a Funding deposit',
      { walletType: 1 },
      'USDT:funding',
      'Binance Funding · USDT',
      'h-USDT:funding',
    ],
  ])(
    'places %s of USDT on its own coin and wallet holding',
    async (_label, over, key, name, id) => {
      const store = creatingStore();
      const deps = makeDeps({
        ...store,
        fetchDepositHistory: rowsAtNow([deposit({ coin: 'USDT', amount: '12.5', ...over })]),
      });

      const result = await sync(deps);

      expect(store.ensureHoldings).toHaveBeenCalledWith([
        expect.objectContaining({ name, metadataKey: key, balanceMinorUnits: 0 }),
      ]);
      expect(addedRows(deps)).toEqual([
        expect.objectContaining({
          holdingId: id,
          amountMinorUnits: 1_250_000_000,
          externalId: 'acc-1:deposit:1',
          description: 'USDT',
        }),
      ]);
      expect(result).toEqual({ imported: 1, complete: true });
    },
  );

  it('takes a USDT withdrawal out of the wallet it left, signed, in the coin scale', async () => {
    const store = creatingStore();
    const deps = makeDeps({
      ...store,
      fetchWithdrawHistory: rowsAtNow([withdrawal({ coin: 'USDT', amount: '1.5', walletType: 1 })]),
    });

    await sync(deps);

    expect(addedRows(deps)).toEqual([
      expect.objectContaining({
        holdingId: 'h-USDT:funding',
        amountMinorUnits: -150_000_000,
        externalId: 'acc-1:withdraw:9',
        description: 'USDT',
      }),
    ]);
  });

  it('reads a lowercase coin upper-cased', async () => {
    const store = creatingStore();
    const deps = makeDeps({
      ...store,
      fetchDepositHistory: rowsAtNow([deposit({ coin: 'usdt', amount: '2' })]),
    });

    await sync(deps);

    expect(addedRows(deps)).toEqual([
      expect.objectContaining({
        holdingId: 'h-USDT',
        amountMinorUnits: 200_000_000,
        description: 'USDT',
      }),
    ]);
  });

  it('keeps the BTC keys, holdings and amounts as they were', async () => {
    const deps = makeDeps({
      fetchDepositHistory: rowsAtNow([deposit({ id: '42' })]),
      fetchWithdrawHistory: rowsAtNow([withdrawal({ id: '7' })]),
    });

    await sync(deps);

    expect(
      addedRows(deps).map((row) => [row.externalId, row.holdingId, row.amountMinorUnits]),
    ).toEqual([
      ['acc-1:deposit:42', 'h-spot', 50_000_000],
      ['acc-1:withdraw:7', 'h-spot', -25_000_000],
    ]);
    expect(addedRows(deps).every((row) => row.description === 'BTC')).toBe(true);
  });

  it('stops the window when a new row of a coin has no holding even after creation', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = makeDeps({ fetchDepositHistory: rowsAtNow([deposit({ coin: 'USDT' })]) });

    const result = await sync(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
    expect(warn).toHaveBeenCalledWith(STOP_TAG, {
      name: 'BinanceWalkStop',
      code: 'capital-holding-missing',
    });
    warn.mockRestore();
  });
});

describe('capital records of a coin that is not tracked', () => {
  const untrackedPatchesOf = (deps: BinanceTransactionSyncDeps) =>
    coinListPatchesOf(deps).filter((patch) => patch.coins === 'untrackedCoins');

  it('counts a PEPE deposit, imports no row for it and lists its ticker once', async () => {
    const deps = makeDeps({
      fetchDepositHistory: rowsAtNow([deposit({ id: '2' })], [untrackedRecord()]),
    });

    const result = await sync(deps);

    expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:deposit:2']);
    expect(result).toEqual({ imported: 1, complete: true });
    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
    ]);
  });

  it('writes the list before the cursor of the window, once for the window', async () => {
    const fake = walkStateFake({
      accountId: ACCOUNT_ID,
      marks: { capital: { cursor: NOW - 3 * DAY_MS } },
    });
    const deps = makeDeps({
      ...fake.deps,
      fetchDepositHistory: rowsAtNow([], [untrackedRecord(), untrackedRecord()]),
      fetchWithdrawHistory: rowsAtNow([], [untrackedWithdrawal()]),
    });

    await sync(deps);

    const kinds = (deps.patchExchangeState as jest.Mock).mock.calls.flatMap(([, patches]) =>
      patches.map((patch: { kind: string }) => patch.kind),
    );
    expect(kinds.filter((kind: string) => kind === 'coinList')).toHaveLength(1);
    expect(kinds.indexOf('coinList')).toBeLessThan(kinds.indexOf('walk'));
    expect(untrackedPatchesOf(deps)[0].tickers).toEqual(['PEPE']);
    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('writes no list for a window of tracked coins', async () => {
    const deps = makeDeps({ fetchDepositHistory: rowsAtNow([deposit()]) });

    await sync(deps);

    expect(coinListPatchesOf(deps)).toEqual([]);
  });

  it('moves the cursor past a window that holds only untracked records', async () => {
    const deps = makeDeps({ fetchWithdrawHistory: rowsAtNow([], [untrackedWithdrawal()]) });

    await sync(deps);

    expect(walkMarkWritesOf(deps, 'capital', 'cursor')).toEqual([NOW]);
    expect(untrackedPatchesOf(deps)).toHaveLength(1);
  });

  it.each([
    ['status 0', untrackedRecord({ status: 0 })],
    ['status 3', untrackedRecord({ status: 3 })],
    ['no status', untrackedRecord({ status: undefined })],
  ])('does not list a coin whose record is not settled (%s)', async (_label, record) => {
    const deps = makeDeps({
      fetchDepositHistory: rowsAtNow([], [record]),
      fetchWithdrawHistory: rowsAtNow([], [{ ...record, time: '2024-01-03 00:00:00' }]),
    });

    const result = await sync(deps);

    expect(coinListPatchesOf(deps)).toEqual([]);
    expect(result).toEqual({ imported: 0, complete: true });
  });

  it('lists a settled record whose time is no usable time: it has no point to return', async () => {
    const deps = makeDeps({
      fetchDepositHistory: rowsAtNow([], [untrackedRecord({ time: undefined })]),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(untrackedPatchesOf(deps)[0].tickers).toEqual(['PEPE']);
  });

  it('settles a withdrawal and a deposit by their own settled status', async () => {
    const deps = makeDeps({
      fetchDepositHistory: rowsAtNow([], [untrackedRecord({ ticker: 'DEPOSITED', status: 6 })]),
      fetchWithdrawHistory: rowsAtNow(
        [],
        [untrackedRecord({ ticker: 'WITHDRAWN', status: 1, time: '2024-01-03 00:00:00' })],
      ),
    });

    await sync(deps);

    expect(coinListPatchesOf(deps)).toEqual([]);
  });

  it('counts an untracked record toward a full page, so a page of them is read in halves', async () => {
    const full = Array.from({ length: HISTORY_PAGE_LIMIT }, () => untrackedRecord());
    const deps = makeDeps({
      fetchDepositHistory: jest.fn(
        async (_apiKey: string, _secret: string, window: HistoryWindow) =>
          historyPage([], window.endTime - window.startTime > DAY_MS / 2 ? full : []),
      ),
    });

    await sync(deps);

    const windows = (deps.fetchDepositHistory as jest.Mock).mock.calls.map(
      ([, , window]) => window as HistoryWindow,
    );
    const [first] = windows;
    const width = (window: HistoryWindow) => window.endTime - window.startTime;
    expect(windows.some((window) => window.offset > 0)).toBe(false);
    expect(
      windows.some(
        (window) =>
          window.startTime >= first.startTime &&
          window.endTime <= first.endTime &&
          width(window) <= width(first) / 2 + 1,
      ),
    ).toBe(true);
  });

  it('stops at a TRACKED record whose amount is too precise, never skipping it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = makeDeps({
      fetchDepositHistory: rowsAtNow(
        [deposit({ id: '1', coin: 'USDT', amount: '0.000000001' })],
        [untrackedRecord()],
      ),
    });

    const result = await sync(deps);

    expect(result.complete).toBe(false);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(STOP_TAG, {
      name: 'BinanceWalkStop',
      code: 'amount-precision',
    });
    warn.mockRestore();
  });
});

describe('a page beside an off-contract row of an untracked coin, read by the real client', () => {
  const bodyFetch = (body: unknown) =>
    (async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => body,
    })) as unknown as typeof fetch;

  /** The same JSON body for the span that ends at now, nothing for any other span or page. */
  const servedAtNow = <Row>(
    body: unknown,
    read: (
      apiKey: string,
      secret: string,
      window: HistoryWindow,
      options: { fetchImpl: typeof fetch; now: () => number },
    ) => Promise<CapitalPage<Row>>,
  ) =>
    jest.fn(async (apiKey: string, secret: string, window: HistoryWindow) =>
      read(apiKey, secret, window, {
        fetchImpl: bodyFetch(window.endTime === NOW && window.offset === 0 ? body : []),
        now: () => NOW,
      }),
    );

  const btcDeposit = {
    id: '2',
    amount: '0.5',
    coin: 'BTC',
    insertTime: NOW - DAY_MS,
    status: 1,
  };
  const btcWithdrawal = {
    id: '9',
    amount: '0.25',
    coin: 'BTC',
    applyTime: '2024-01-03 00:00:00',
    status: 6,
  };

  it.each([
    ['an amount that is a JSON number', { coin: 'PEPE', amount: 1000, insertTime: NOW - DAY_MS }],
    ['no amount and no id', { coin: 'PEPE', status: 1, insertTime: NOW - DAY_MS }],
    ['nothing but its coin', { coin: 'PEPE' }],
  ])('imports the BTC deposit and moves the cursor past a PEPE row with %s', async (_l, pepe) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = makeDeps({
      fetchDepositHistory: servedAtNow([pepe, btcDeposit], fetchDepositHistory),
    });

    const result = await sync(deps);

    expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:deposit:2']);
    expect(result).toEqual({ imported: 1, complete: true });
    expect(walkMarkWritesOf(deps, 'capital', 'cursor')).toEqual([NOW]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([
    [
      'an amount that is a JSON number',
      { coin: 'PEPE', amount: 1000, applyTime: '2024-01-03 00:00:00', status: 6 },
    ],
    ['no amount and no id', { coin: 'PEPE', status: 6, applyTime: '2024-01-03 00:00:00' }],
    ['nothing but its coin', { coin: 'PEPE' }],
  ])(
    'imports the BTC withdrawal and moves the cursor past a PEPE row with %s',
    async (_l, pepe) => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const deps = makeDeps({
        fetchWithdrawHistory: servedAtNow([pepe, btcWithdrawal], fetchWithdrawHistory),
      });

      const result = await sync(deps);

      expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:withdraw:9']);
      expect(result).toEqual({ imported: 1, complete: true });
      expect(walkMarkWritesOf(deps, 'capital', 'cursor')).toEqual([NOW]);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    },
  );

  it('lists a settled off-contract PEPE row once, beside the imported BTC row', async () => {
    const deps = makeDeps({
      fetchDepositHistory: servedAtNow(
        [{ coin: 'pepe', amount: 1000, status: 1, insertTime: NOW - DAY_MS }, btcDeposit],
        fetchDepositHistory,
      ),
    });

    await sync(deps);

    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
    ]);
  });
});

describe('a capital record with a blank coin', () => {
  it.each([
    ['empty', ''],
    ['spaces', '   '],
  ])(
    'is no untracked record when its coin is %s: it stops and owes its point',
    async (_label, coin) => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const blankTime = NOW - 10 * DAY_MS;
      const deps = makeDeps({
        fetchDepositHistory: rowsAtNow([deposit({ id: 'ok', insertTime: NOW - 5 * DAY_MS })]),
        fetchWithdrawHistory: jest.fn(
          async (_apiKey: string, _secret: string, window: HistoryWindow) =>
            historyPage(
              window.endTime === NOW
                ? []
                : [withdrawal({ id: 'blank', coin, applyTime: blankTime })],
            ),
        ),
      });

      await sync(deps);

      expect(coinListPatchesOf(deps)).toEqual([]);
      expect(warn).toHaveBeenCalledWith(STOP_TAG, {
        name: 'BinanceWalkStop',
        code: 'capital-row-unreadable',
      });
      expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:deposit:ok']);
      warn.mockRestore();
    },
  );
});

describe('an account with no Spot BTC holding', () => {
  const withoutCursor = walkStateFake({ accountId: ACCOUNT_ID }).deps;

  it('imports a Spot deposit with no Spot BTC holding and creates it', async () => {
    let stored: HoldingRow[] = [];
    const ensureHoldings = jest.fn(async (_holdings: unknown[]) => {
      stored = [spotHolding];
    });
    const deps = makeDeps({
      listHoldings: async () => stored,
      ensureHoldings,
      fetchDepositHistory: rowsAtNow([deposit()]),
    });

    const result = await sync(deps);

    expect(ensureHoldings).toHaveBeenCalledWith([
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        name: 'Binance Spot · BTC',
        metadataKey: 'BTC',
        balanceMinorUnits: 0,
      }),
    ]);
    expect(addedRows(deps).map((row) => [row.externalId, row.holdingId])).toEqual([
      ['acc-1:deposit:1', 'h-spot'],
    ]);
    expect(result).toEqual({ imported: 1, complete: true });
  });

  it('reads no legacy capital cursor and starts at the floor: it never ran this walk', async () => {
    const latestTransactionTime = jest.fn(async () => NOW - 89 * DAY_MS);
    const deps = makeDeps({
      ...withoutCursor,
      listHoldings: async () => [],
      latestTransactionTime,
    });

    await sync(deps);

    const windows = (deps.fetchDepositHistory as jest.Mock).mock.calls.map((call) => call[2]);
    expect(latestTransactionTime).not.toHaveBeenCalled();
    expect(windows[0].startTime).toBe(HISTORY_FLOOR_MS);
  });

  it('still reads the legacy capital cursor of the Spot BTC holding it has', async () => {
    const latestTransactionTime = jest.fn(async () => NOW - 89 * DAY_MS);
    const deps = makeDeps({ ...withoutCursor, latestTransactionTime });

    await sync(deps);

    expect(latestTransactionTime).toHaveBeenCalledWith('h-spot', [
      'acc-1:deposit:',
      'acc-1:withdraw:',
    ]);
  });

  it('leaves a stored row out when its wallet has no holding, and imports a new row beside it', async () => {
    const deps = makeDeps({
      listHoldings: async () => [fundingHolding],
      storedExternalIds: jest.fn(async () => new Set(['acc-1:deposit:1'])),
      fetchDepositHistory: rowsAtNow([
        deposit({ id: '1', walletType: 0 }),
        deposit({ id: '2', walletType: 1 }),
      ]),
    });

    const result = await sync(deps);

    expect(addedRows(deps).map((row) => [row.externalId, row.holdingId])).toEqual([
      ['acc-1:deposit:2', 'h-funding'],
    ]);
    expect(deps.ensureHoldings).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 1, complete: true });
  });

  it('stops the window when a new row has no wallet holding even after creation', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = makeDeps({
      listHoldings: async () => [],
      fetchDepositHistory: rowsAtNow([deposit()]),
    });

    const result = await sync(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
    warn.mockRestore();
  });
});
