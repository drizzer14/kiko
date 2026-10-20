import { fetchUniversalTransfers } from './binance.history-client';

const NOW = 1_704_326_400_000;

const transferRow = {
  asset: 'USDT',
  amount: '12.5',
  type: 'MAIN_FUNDING',
  status: 'CONFIRMED',
  tranId: '11415',
  timestamp: NOW - 1_000,
};

const readTransfers = (rows: unknown[]) =>
  fetchUniversalTransfers(
    'api-key-fixture',
    'secret-fixture',
    { type: 'MAIN_FUNDING', startTime: NOW - 10_000, endTime: NOW, current: 1 },
    {
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ total: rows.length, rows }),
      })) as unknown as typeof fetch,
      now: () => NOW,
    },
  );

describe('the asset of a transfer row', () => {
  it('reads a tracked asset of any case or padding upper-cased, once', async () => {
    const page = await readTransfers([{ ...transferRow, asset: ' usdt ' }]);

    expect(page.rows).toEqual([transferRow]);
    expect(page.untracked).toEqual([]);
  });

  it('reports a row of an untracked asset by its upper-cased ticker, status and time alone', async () => {
    const page = await readTransfers([
      { ...transferRow, asset: ' xyz ', amount: 'secret-amount', tranId: 'secret-id' },
    ]);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([
      { ticker: 'XYZ', status: 'CONFIRMED', time: transferRow.timestamp },
    ]);
    expect(JSON.stringify(page.untracked)).not.toMatch(/secret/);
  });

  it('reports no status and no time for an untracked row that has neither as usable', async () => {
    const page = await readTransfers([
      { asset: 'XYZ', status: 7, timestamp: 'now' },
      { asset: 'ABC', status: null, timestamp: Number.NaN },
    ]);

    expect(page.untracked).toEqual([
      { ticker: 'XYZ', status: undefined, time: undefined },
      { ticker: 'ABC', status: undefined, time: undefined },
    ]);
  });

  it.each([
    ['empty', ''],
    ['blank', '  '],
  ])(
    'reads a settled row whose asset is %s as unreadable, never as untracked',
    async (_label, asset) => {
      const page = await readTransfers([{ ...transferRow, asset }]);

      expect(page.rows).toEqual([]);
      expect(page.untracked).toEqual([]);
      expect(page.unreadable).toEqual([{ time: transferRow.timestamp }]);
    },
  );

  it('counts a row with no usable asset that is not settled, and reports it with an empty ticker', async () => {
    const page = await readTransfers([{ ...transferRow, asset: '', status: 'FAILED' }]);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([{ ticker: '', status: 'FAILED', time: transferRow.timestamp }]);
    expect(page.gathered).toBe(1);
  });

  it('counts every row of the page, tracked, untracked and unreadable', async () => {
    const page = await readTransfers([
      transferRow,
      { ...transferRow, asset: 'XYZ' },
      { ...transferRow, amount: 5 },
    ]);

    expect([page.rows.length, page.untracked.length, page.unreadable.length]).toEqual([1, 1, 1]);
    expect(page.gathered).toBe(3);
  });
});
