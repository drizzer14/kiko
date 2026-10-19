import {
  type BinanceDeposit,
  type BinanceWithdrawal,
  fetchDepositHistory,
  fetchWithdrawHistory,
  type HistoryPage,
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

const readDeposits = (body: unknown): Promise<HistoryPage<BinanceDeposit>> =>
  fetchDepositHistory('api-key-fixture', 'secret-fixture', WINDOW, options(body));

const readWithdrawals = (body: unknown): Promise<HistoryPage<BinanceWithdrawal>> =>
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
});
