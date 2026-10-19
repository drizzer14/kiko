import {
  type BinanceDeposit,
  type BinanceWithdrawal,
  type CapitalPage,
  fetchDepositHistory,
  fetchWithdrawHistory,
} from './binance.history-client';

const NOW = 1_704_326_400_000;

const depositRow = {
  id: '1',
  amount: '0.5',
  coin: 'USDT',
  insertTime: NOW,
  status: 1,
  walletType: 1,
};

const withdrawalRow = {
  id: '9',
  amount: '12',
  coin: 'USDT',
  applyTime: '2023-11-15 08:30:00',
  status: 6,
  walletType: 0,
};

const bodyFetch = (body: unknown) =>
  (async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  })) as unknown as typeof fetch;

const options = (body: unknown) => ({ fetchImpl: bodyFetch(body), now: () => NOW });

const WINDOW = { startTime: NOW - 1000, endTime: NOW, offset: 0 };

const readDeposits = (body: unknown): Promise<CapitalPage<BinanceDeposit>> =>
  fetchDepositHistory('api-key-fixture', 'secret-fixture', WINDOW, options(body));

const readWithdrawals = (body: unknown): Promise<CapitalPage<BinanceWithdrawal>> =>
  fetchWithdrawHistory('api-key-fixture', 'secret-fixture', WINDOW, options(body));

const without = (row: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));

describe('the coin of a capital row', () => {
  it('reads the coin of any ticker as the text it is', async () => {
    const deposits = await readDeposits([depositRow]);
    const withdrawals = await readWithdrawals([withdrawalRow]);

    expect(deposits.rows).toMatchObject([depositRow]);
    expect(withdrawals.rows).toMatchObject([withdrawalRow]);
  });

  it.each([
    ['without a coin', without(depositRow, 'coin')],
    ['with a coin that is not text', { ...depositRow, coin: 5 }],
    ['with a null coin', { ...depositRow, coin: null }],
  ])('reports a deposit %s as unreadable, with its insertTime', async (_label, row) => {
    const page = await readDeposits([row]);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: NOW }]);
  });

  it.each([
    ['without a coin', without(withdrawalRow, 'coin')],
    ['with a coin that is not text', { ...withdrawalRow, coin: 5 }],
  ])('reports a withdrawal %s as unreadable, with its applyTime', async (_label, row) => {
    const page = await readWithdrawals([row]);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: withdrawalRow.applyTime }]);
  });

  it.each([
    ['empty', ''],
    ['spaces', '   '],
  ])('reports a row whose coin is %s as unreadable, never untracked', async (_label, coin) => {
    const deposits = await readDeposits([{ ...depositRow, coin }]);
    const withdrawals = await readWithdrawals([{ ...withdrawalRow, coin }]);

    expect(deposits).toMatchObject({ rows: [], untracked: [], unreadable: [{ time: NOW }] });
    expect(withdrawals).toMatchObject({
      rows: [],
      untracked: [],
      unreadable: [{ time: withdrawalRow.applyTime }],
    });
  });
});

describe('a record that is not settled is counted whatever its coin', () => {
  it.each([
    ['an empty coin', ''],
    ['a coin of spaces', '   '],
    ['a null coin', null],
    ['a coin that is not text', 5],
  ])('counts a cancelled deposit with %s, never parsing it', async (_label, coin) => {
    const page = await readDeposits([{ ...depositRow, coin, status: 0 }]);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([{ ticker: '', status: 0, time: NOW }]);
  });

  it.each([
    ['an empty coin', ''],
    ['a coin of spaces', '   '],
    ['a null coin', null],
    ['a coin that is not text', 5],
  ])('counts a cancelled withdrawal with %s, never parsing it', async (_label, coin) => {
    const page = await readWithdrawals([{ ...withdrawalRow, coin, status: 1 }]);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([{ ticker: '', status: 1, time: withdrawalRow.applyTime }]);
  });

  it('counts a record with no status and no usable coin: it is not settled', async () => {
    const page = await readDeposits([{ ...without(depositRow, 'status'), coin: '' }]);

    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([{ ticker: '', status: undefined, time: NOW }]);
  });

  it('keeps the ticker of a record that is not settled, so the walk can still count it', async () => {
    const page = await readWithdrawals([{ ...withdrawalRow, coin: 'pepe', status: 3 }]);

    expect(page.untracked).toEqual([{ ticker: 'PEPE', status: 3, time: withdrawalRow.applyTime }]);
  });

  it.each([
    ['a deposit', () => readDeposits([{ ...depositRow, coin: '' }])],
    ['a withdrawal', () => readWithdrawals([{ ...withdrawalRow, coin: null }])],
  ])('still reports a SETTLED %s with no usable coin as unreadable', async (_label, read) => {
    const page = await read();

    expect(page.untracked).toEqual([]);
    expect(page.unreadable).toHaveLength(1);
  });
});

type Case = [label: string, row: Record<string, unknown>, time: number | string | undefined];

describe('an off-contract row of an untracked coin is counted and never parsed', () => {
  const depositCases: Case[] = [
    ['an amount that is a JSON number', { ...depositRow, coin: 'PEPE', amount: 1000 }, NOW],
    ['no amount', { ...without(depositRow, 'amount'), coin: 'PEPE' }, NOW],
    ['no id and no status', { coin: 'PEPE', insertTime: NOW }, NOW],
    ['a fractional walletType', { ...depositRow, coin: 'PEPE', walletType: 0.5 }, NOW],
    ['no insertTime', { ...without(depositRow, 'insertTime'), coin: 'PEPE' }, undefined],
    ['a text insertTime', { ...depositRow, coin: 'PEPE', insertTime: 'soon' }, undefined],
    ['nothing but its coin', { coin: 'PEPE' }, undefined],
  ];
  const withdrawalCases: Case[] = [
    [
      'an amount that is a JSON number',
      { ...withdrawalRow, coin: 'PEPE', amount: 1000 },
      withdrawalRow.applyTime,
    ],
    ['no amount', { ...without(withdrawalRow, 'amount'), coin: 'PEPE' }, withdrawalRow.applyTime],
    [
      'a fee that is not text',
      { ...withdrawalRow, coin: 'PEPE', transactionFee: 5 },
      withdrawalRow.applyTime,
    ],
    ['a numeric applyTime', { ...withdrawalRow, coin: 'PEPE', applyTime: NOW }, NOW],
    ['no applyTime', { ...without(withdrawalRow, 'applyTime'), coin: 'PEPE' }, undefined],
    ['nothing but its coin', { coin: 'PEPE' }, undefined],
  ];

  it.each(depositCases)('a deposit with %s', async (_label, row, time) => {
    const page = await readDeposits([row]);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([{ ticker: 'PEPE', status: row.status, time }]);
  });

  it.each(withdrawalCases)('a withdrawal with %s', async (_label, row, time) => {
    const page = await readWithdrawals([row]);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([{ ticker: 'PEPE', status: row.status, time }]);
  });

  it('reports the ticker upper-cased and trimmed, once', async () => {
    const page = await readDeposits([{ ...depositRow, coin: ' pepe ', amount: 1 }]);

    expect(page.untracked).toEqual([{ ticker: 'PEPE', status: 1, time: NOW }]);
  });

  it('reads a status that is not a finite number as no status', async () => {
    const page = await readDeposits([
      { ...depositRow, coin: 'PEPE', status: 'done' },
      { ...depositRow, coin: 'PEPE', status: null },
    ]);

    expect(page.untracked.map(({ status }) => status)).toEqual([undefined, undefined]);
  });

  it('still reads a TRACKED row strictly: a malformed one is unreadable and owed', async () => {
    const deposits = await readDeposits([
      { ...depositRow, coin: 'usdt', amount: 1000 },
      { ...depositRow, coin: 'BTC', amount: 1000 },
    ]);
    const withdrawals = await readWithdrawals([{ ...withdrawalRow, coin: 'USDT', amount: 1000 }]);

    expect(deposits).toMatchObject({
      rows: [],
      untracked: [],
      unreadable: [{ time: NOW }, { time: NOW }],
    });
    expect(withdrawals).toMatchObject({
      rows: [],
      untracked: [],
      unreadable: [{ time: withdrawalRow.applyTime }],
    });
  });

  it('keeps the rows, the untracked records and the unreadable rows of one page apart', async () => {
    const page = await readDeposits([
      { ...depositRow, id: '1' },
      { ...depositRow, id: '2', coin: 'PEPE', amount: 5 },
      { ...depositRow, id: '3', amount: 5 },
    ]);

    expect(page.rows.map(({ id }) => id)).toEqual(['1']);
    expect(page.untracked).toHaveLength(1);
    expect(page.unreadable).toHaveLength(1);
  });

  it('keeps nothing of an untracked row but its ticker, status and time', async () => {
    const page = await readDeposits([
      { ...depositRow, coin: 'PEPE', id: 'SECRET-ID', address: 'SECRET' },
    ]);

    expect(JSON.stringify(page.untracked)).not.toMatch(/SECRET/);
    expect(Object.keys(page.untracked[0]).sort()).toEqual(['status', 'ticker', 'time']);
  });
});
