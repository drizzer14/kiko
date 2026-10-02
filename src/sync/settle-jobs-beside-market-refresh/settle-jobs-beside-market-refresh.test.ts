import { right } from 'fnts/either';

const mockRefreshMarketData = jest.fn();
const mockConfirmDailyLimit = jest.fn();
const mockOpenCurrenciesQuery = jest.fn();

jest.mock('@kiko/prices/daily-limit', () => ({
  confirmDailyLimit: (...args: unknown[]) => mockConfirmDailyLimit(...args),
}));
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { openCurrenciesQuery: (...args: unknown[]) => mockOpenCurrenciesQuery(...args) },
}));

import { settleJobsBesideMarketRefresh } from './settle-jobs-beside-market-refresh';

const rowsOf = (...currencies: string[]) => currencies.map((currency) => ({ currency }));

describe('settleJobsBesideMarketRefresh', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockConfirmDailyLimit.mockResolvedValue(undefined);
    mockOpenCurrenciesQuery.mockResolvedValue(rowsOf('UAH', 'USD'));
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('starts the market data refresh while a job is still running', async () => {
    let releaseJob!: () => void;
    const run = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseJob = resolve;
        }),
    );

    const settled = settleJobsBesideMarketRefresh([{ name: 'Mono', run }], '[test]');

    await new Promise((resolve) => setImmediate(resolve));
    expect(run).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).toHaveBeenCalledWith({
      throttled: true,
      metals: true,
      fiatOfRun: expect.any(Object),
    });

    releaseJob();
    await settled;
  });

  it('confirms the daily limit before the refresh, and refreshes anyway when the check fails', async () => {
    const order: string[] = [];
    mockConfirmDailyLimit.mockImplementation(async () => {
      order.push('confirm');
      throw new Error('settings read failed');
    });
    mockRefreshMarketData.mockImplementation(async () => {
      order.push('refresh');

      return right(undefined);
    });

    await settleJobsBesideMarketRefresh([], '[test]');

    expect(order).toEqual(['confirm', 'refresh']);
  });

  it('returns one settled result per job, in job order, and does not reject on a failed job', async () => {
    const failure = new Error('429');
    const results = await settleJobsBesideMarketRefresh(
      [
        { name: 'A', run: () => Promise.resolve('ok') },
        { name: 'B', run: () => Promise.reject(failure) },
      ],
      '[test]',
    );

    expect(results).toEqual([
      { status: 'fulfilled', value: 'ok' },
      { status: 'rejected', reason: failure },
    ]);
  });

  it('settles only after the refresh has settled too', async () => {
    let releaseRefresh!: () => void;
    mockRefreshMarketData.mockReturnValue(
      new Promise((resolve) => {
        releaseRefresh = () => resolve(right(undefined));
      }),
    );
    let done = false;

    const settled = settleJobsBesideMarketRefresh(
      [{ name: 'A', run: () => Promise.resolve() }],
      '[test]',
    ).then(() => {
      done = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(done).toBe(false);

    releaseRefresh();
    await settled;
    expect(done).toBe(true);
  });

  it('refreshes once and reads no holdings when there is no job', async () => {
    await settleJobsBesideMarketRefresh([], '[test]');

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
    expect(mockOpenCurrenciesQuery).not.toHaveBeenCalled();
  });

  it('refreshes once when the jobs leave the held currencies as they were', async () => {
    mockOpenCurrenciesQuery
      .mockResolvedValueOnce(rowsOf('UAH', 'USD'))
      .mockResolvedValueOnce(rowsOf('USD', 'UAH'));

    await settleJobsBesideMarketRefresh([{ name: 'A', run: () => Promise.resolve() }], '[test]');

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
  });

  it('refreshes once when a job only closes a currency', async () => {
    mockOpenCurrenciesQuery
      .mockResolvedValueOnce(rowsOf('UAH', 'USD'))
      .mockResolvedValueOnce(rowsOf('UAH'));

    await settleJobsBesideMarketRefresh([{ name: 'A', run: () => Promise.resolve() }], '[test]');

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
  });

  it('tops up the rates once the jobs have settled when a job brings in a new currency', async () => {
    mockOpenCurrenciesQuery
      .mockResolvedValueOnce(rowsOf('UAH'))
      .mockResolvedValueOnce(rowsOf('UAH', 'BTC'));
    const order: string[] = [];
    mockRefreshMarketData.mockImplementation(async (options: { metals: boolean }) => {
      order.push(options.metals ? 'full refresh' : 'rates top-up');

      return right(undefined);
    });

    await settleJobsBesideMarketRefresh(
      [
        {
          name: 'Binance',
          run: async () => {
            order.push('job');
          },
        },
      ],
      '[test]',
    );

    expect([...order].sort()).toEqual(['full refresh', 'job', 'rates top-up']);
    expect(order.at(-1)).toBe('rates top-up');
    expect(mockRefreshMarketData).toHaveBeenLastCalledWith({
      throttled: true,
      metals: false,
      fiatOfRun: expect.any(Object),
    });
  });

  it('hands the top-up the same fiat answer record as the refresh beside the jobs, so it asks no fiat source again', async () => {
    mockOpenCurrenciesQuery
      .mockResolvedValueOnce(rowsOf('UAH'))
      .mockResolvedValueOnce(rowsOf('UAH', 'BTC'));

    await settleJobsBesideMarketRefresh([{ name: 'A', run: () => Promise.resolve() }], '[test]');

    const [[firstOptions], [topUpOptions]] = mockRefreshMarketData.mock.calls;

    expect(topUpOptions.fiatOfRun).toBe(firstOptions.fiatOfRun);
  });

  it('starts a new fiat answer record for every run', async () => {
    await settleJobsBesideMarketRefresh([{ name: 'A', run: () => Promise.resolve() }], '[test]');
    await settleJobsBesideMarketRefresh([{ name: 'A', run: () => Promise.resolve() }], '[test]');

    const [[firstRun], [secondRun]] = mockRefreshMarketData.mock.calls;

    expect(secondRun.fiatOfRun).not.toBe(firstRun.fiatOfRun);
  });

  it('never rejects and tops up nothing when the holdings cannot be read', async () => {
    mockOpenCurrenciesQuery.mockRejectedValue(new Error('read failed'));

    await expect(
      settleJobsBesideMarketRefresh([{ name: 'A', run: () => Promise.resolve() }], '[test]'),
    ).resolves.toHaveLength(1);

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
  });
});
