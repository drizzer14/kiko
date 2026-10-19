import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { coinListPatchesOf, walkMarkWritesOf, walkStateFake } from '@kiko/test-support/walk-marks';

import {
  type BinanceTransactionRow,
  type BinanceTransactionSyncDeps,
  syncBinanceTransactions,
} from './binance.transactions';
import type {
  BinanceDeposit,
  BinanceWithdrawal,
  HistoryPage,
  HistoryWindow,
} from './binance.history-client';
import { createBinanceHistoryRun } from './binance.history-budget';

const NOW = 1_704_326_400_000; // 2024-01-04T00:00:00Z
const ACCOUNT_ID = 'acc-1';
const STOP_TAG = '[binance sync] history window stopped';

const spotHolding = { id: 'h-spot', metadata: { binanceAsset: 'BTC' } } as unknown as HoldingRow;

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

const historyPage = <Row>(rows: Row[]): HistoryPage<Row> => ({
  rows,
  unreadable: [],
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
});

/** A history that holds `rows` only in a span ending at now, so no span behind it reads any. */
const rowsAtNow = <Row>(rows: Row[]) =>
  jest.fn(async (_apiKey: string, _secret: string, window: HistoryWindow) =>
    historyPage(window.endTime === NOW ? rows : []),
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
      fetchDepositHistory: rowsAtNow([
        deposit({ id: '1', coin: 'PEPE', amount: '1000000' }),
        deposit({ id: '2' }),
      ]),
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
      fetchDepositHistory: rowsAtNow([
        deposit({ id: '1', coin: 'PEPE' }),
        deposit({ id: '2', coin: 'pepe' }),
      ]),
      fetchWithdrawHistory: rowsAtNow([withdrawal({ coin: 'PEPE' })]),
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
    const deps = makeDeps({ fetchWithdrawHistory: rowsAtNow([withdrawal({ coin: 'PEPE' })]) });

    await sync(deps);

    expect(walkMarkWritesOf(deps, 'capital', 'cursor')).toEqual([NOW]);
    expect(untrackedPatchesOf(deps)).toHaveLength(1);
  });

  it('does not list a coin whose record is not settled', async () => {
    const deps = makeDeps({
      fetchDepositHistory: rowsAtNow([deposit({ coin: 'PEPE', status: 0 })]),
      fetchWithdrawHistory: rowsAtNow([withdrawal({ coin: 'PEPE', status: 3 })]),
    });

    await sync(deps);

    expect(coinListPatchesOf(deps)).toEqual([]);
  });

  it('reads an untracked record by nothing but its ticker: a malformed amount is no stop', async () => {
    const deps = makeDeps({
      fetchDepositHistory: rowsAtNow([deposit({ coin: 'PEPE', amount: 'lots' })]),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(untrackedPatchesOf(deps)[0].tickers).toEqual(['PEPE']);
  });

  it('stops at a TRACKED record whose amount is too precise, never skipping it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = makeDeps({
      fetchDepositHistory: rowsAtNow([
        deposit({ id: '1', coin: 'USDT', amount: '0.000000001' }),
        deposit({ id: '2', coin: 'PEPE' }),
      ]),
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
