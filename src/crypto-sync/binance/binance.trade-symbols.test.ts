import type { CoinLists, ExchangeTrades } from '@kiko/crypto-sync/exchange/walk-state';

import {
  readSpotSymbols,
  TRADE_MAIN_QUOTES,
  tradeCandidatesOf,
  touchedCoinsOf,
  TRADING_SYMBOL_STATUSES,
} from './binance.trade-symbols';
import {
  type BinanceExchangeSymbol,
  BinanceHistoryParseError,
  type ExchangeSymbolsPage,
  fetchExchangeSymbols,
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';
import { createBinanceHistoryRun } from './binance.history-budget';

const NOW = 1_704_326_400_000;

const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

const listed = (
  symbol: string,
  status: string,
  baseAsset: string,
  quoteAsset: string,
): BinanceExchangeSymbol => ({ symbol, status, baseAsset, quoteAsset });

const NO_COINS: Required<CoinLists> = { balance: [], history: [] };

const EMPTY_TRADES: ExchangeTrades = { symbols: {}, rotation: '', balanceSnapshot: {} };

const tradesOf = (symbols: ExchangeTrades['symbols']): ExchangeTrades => ({
  ...EMPTY_TRADES,
  symbols,
});

const pageOf = (symbols: BinanceExchangeSymbol[]): ExchangeSymbolsPage => ({
  symbols,
  unreadable: 0,
  usedApiWeight1m: undefined,
});

const apiWeightOf = (usedApiWeight1m: number) => ({
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  usedApiWeight1m,
});

type Touched = Parameters<typeof touchedCoinsOf>[0];

const touchedFrom = (overrides: Partial<Touched>): string[] =>
  [
    ...touchedCoinsOf({
      holdingAssets: [],
      trades: EMPTY_TRADES,
      untrackedCoins: NO_COINS,
      oversizedCoins: NO_COINS,
      listing: [],
      ...overrides,
    }),
  ].sort();

type Candidates = Parameters<typeof tradeCandidatesOf>[0];

const candidatesFrom = (overrides: Partial<Candidates> & Pick<Candidates, 'listing'>): string[] =>
  tradeCandidatesOf({ touched: new Set<string>(), trades: EMPTY_TRADES, ...overrides }).map(
    ({ symbol }) => symbol,
  );

const answeringWith = (body: unknown): typeof fetch =>
  (async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  })) as unknown as typeof fetch;

describe('touchedCoinsOf', () => {
  it('names the coin of a holding, even one at zero, as touched', () => {
    expect(touchedFrom({ holdingAssets: ['CGPT'] })).toEqual(['CGPT']);
  });

  it.each([
    ['untracked balance', { untrackedCoins: { balance: ['AAA'], history: [] } }],
    ['untracked history', { untrackedCoins: { balance: [], history: ['AAA'] } }],
    ['oversized balance', { oversizedCoins: { balance: ['AAA'], history: [] } }],
    ['oversized history', { oversizedCoins: { balance: [], history: ['AAA'] } }],
  ])('names a coin of the %s list as touched', (_name, overrides) => {
    expect(touchedFrom(overrides)).toEqual(['AAA']);
  });

  it('names both coins of a symbol with a stored numeric fromId as touched', () => {
    expect(
      touchedFrom({
        trades: tradesOf({ ETHCGPT: { fromId: 5 } }),
        listing: [
          listed('ETHCGPT', 'TRADING', 'ETH', 'CGPT'),
          listed('XYZABC', 'TRADING', 'XYZ', 'ABC'),
        ],
      }),
    ).toEqual(['CGPT', 'ETH']);
  });

  it('does not name the coins of a symbol never read, or of one the listing no longer has', () => {
    expect(
      touchedFrom({
        trades: tradesOf({ ETHCGPT: { fromId: null }, XYZABC: { fromId: 7 } }),
        listing: [listed('ETHCGPT', 'TRADING', 'ETH', 'CGPT')],
      }),
    ).toEqual([]);
  });

  it('names each coin once, whichever sources hold it', () => {
    expect(
      touchedFrom({
        holdingAssets: ['AAA', 'AAA'],
        untrackedCoins: { balance: ['AAA'], history: ['AAA'] },
        oversizedCoins: { balance: ['AAA'], history: ['AAA'] },
      }),
    ).toEqual(['AAA']);
  });

  it('reads a coin the way Binance tickers are kept: trimmed and upper-cased', () => {
    expect(touchedFrom({ holdingAssets: [' cgpt '] })).toEqual(['CGPT']);
  });
});

describe('tradeCandidatesOf', () => {
  it('lists the symbols whose base and quote are touched or a main quote, and are tradable', () => {
    expect(
      candidatesFrom({
        touched: new Set(['BTC', 'CGPT', 'UAH', 'USDT']),
        listing: [
          listed('BTCUSDT', 'TRADING', 'BTC', 'USDT'),
          listed('BNBBTC', 'TRADING', 'BNB', 'BTC'),
          listed('BTCUAH', 'BREAK', 'BTC', 'UAH'),
          listed('ETHBTC', 'TRADING', 'ETH', 'BTC'),
          listed('XYZBTC', 'TRADING', 'XYZ', 'BTC'),
          listed('CGPTUSDT', 'HALT', 'CGPT', 'USDT'),
        ],
      }),
    ).toEqual(['BNBBTC', 'BTCUAH', 'BTCUSDT', 'ETHBTC']);
  });

  it.each(TRADING_SYMBOL_STATUSES)('takes a never-read symbol in status %s', (status) => {
    expect(
      candidatesFrom({
        touched: new Set(['AAA']),
        listing: [listed('AAAUSDT', status, 'AAA', 'USDT')],
      }),
    ).toEqual(['AAAUSDT']);
  });

  it.each(['HALT', 'END_OF_DAY', 'CANCEL_ONLY'])(
    'leaves out a never-read symbol in status %s',
    (status) => {
      expect(
        candidatesFrom({
          touched: new Set(['AAA']),
          listing: [listed('AAAUSDT', status, 'AAA', 'USDT')],
          trades: tradesOf({ AAAUSDT: { fromId: null } }),
        }),
      ).toEqual([]);
    },
  );

  it.each(['HALT', 'END_OF_DAY', 'CANCEL_ONLY'])(
    'keeps a symbol with a stored numeric fromId a candidate in status %s while it is listed',
    (status) => {
      expect(
        candidatesFrom({
          touched: new Set(['AAA']),
          listing: [listed('AAAUSDT', status, 'AAA', 'USDT')],
          trades: tradesOf({ AAAUSDT: { fromId: 12 } }),
        }),
      ).toEqual(['AAAUSDT']);
    },
  );

  it('keeps a symbol with a stored fromId a candidate when the fromId is 0', () => {
    expect(
      candidatesFrom({
        touched: new Set(['AAA']),
        listing: [listed('AAAUSDT', 'HALT', 'AAA', 'USDT')],
        trades: tradesOf({ AAAUSDT: { fromId: 0 } }),
      }),
    ).toEqual(['AAAUSDT']);
  });

  it('gives no candidate for a stored symbol the listing no longer has, and leaves its entry alone', () => {
    const trades = tradesOf({ GONEUSDT: { fromId: 9, heldOrderId: 4 } });

    expect(
      candidatesFrom({
        touched: new Set(['BTC']),
        listing: [listed('BTCUSDT', 'TRADING', 'BTC', 'USDT')],
        trades,
      }),
    ).toEqual(['BTCUSDT']);
    expect(trades.symbols).toEqual({ GONEUSDT: { fromId: 9, heldOrderId: 4 } });
  });

  it('takes a BREAK leveraged token only when its base coin is touched', () => {
    const listing = [listed('BTCUPUSDT', 'BREAK', 'BTCUP', 'USDT')];

    expect(candidatesFrom({ touched: new Set(['BTCUP']), listing })).toEqual(['BTCUPUSDT']);
    expect(candidatesFrom({ touched: new Set(['BTC']), listing })).toEqual([]);
  });

  it.each(TRADE_MAIN_QUOTES)('takes a symbol of a touched coin quoted in %s', (quote) => {
    expect(
      candidatesFrom({
        touched: new Set(['AAA']),
        listing: [listed(`AAA${quote}`, 'TRADING', 'AAA', quote)],
      }),
    ).toEqual([`AAA${quote}`]);
  });

  it('leaves out a symbol with a coin that is neither touched nor a main quote', () => {
    expect(
      candidatesFrom({
        touched: new Set(['AAA']),
        listing: [
          listed('AAAZZZ', 'TRADING', 'AAA', 'ZZZ'),
          listed('ZZZUSDT', 'TRADING', 'ZZZ', 'USDT'),
        ],
      }),
    ).toEqual([]);
  });

  it('lists each candidate once, ascending, whatever the order or repeats of the listing', () => {
    const listing = [
      listed('ETHBTC', 'TRADING', 'ETH', 'BTC'),
      listed('BTCUSDT', 'TRADING', 'BTC', 'USDT'),
      listed('ETHBTC', 'TRADING', 'ETH', 'BTC'),
      listed('BNBBTC', 'TRADING', 'BNB', 'BTC'),
      listed('BTCUSDT', 'TRADING', 'BTC', 'USDT'),
    ];

    expect(candidatesFrom({ touched: new Set(['BTC']), listing })).toEqual([
      'BNBBTC',
      'BTCUSDT',
      'ETHBTC',
    ]);
  });

  it('hands each candidate over with its two coins', () => {
    expect(
      tradeCandidatesOf({
        touched: new Set(['BTC']),
        trades: EMPTY_TRADES,
        listing: [listed('ETHBTC', 'TRADING', 'ETH', 'BTC')],
      }),
    ).toEqual([{ symbol: 'ETHBTC', baseAsset: 'ETH', quoteAsset: 'BTC' }]);
  });
});

describe('readSpotSymbols', () => {
  it('reads the list once and hands the page over', async () => {
    const page = pageOf([listed('ETHBTC', 'TRADING', 'ETH', 'BTC')]);
    const fetchSymbols = jest.fn(async () => page);

    expect(await readSpotSymbols(freshRun(), fetchSymbols)).toBe(page);
    expect(fetchSymbols).toHaveBeenCalledTimes(1);
  });

  it('asks the lane, then the gate, then the request, and records the call after it', async () => {
    const run = freshRun();
    const events: string[] = [];

    jest.spyOn(run.budget, 'canAfford').mockImplementation(() => {
      events.push('canAfford');

      return true;
    });
    jest.spyOn(run.gate, 'wait').mockImplementation(async () => {
      events.push('wait');
    });
    jest.spyOn(run.budget, 'record').mockImplementation(() => {
      events.push('record');
    });

    await readSpotSymbols(run, async () => {
      events.push('fetch');

      return pageOf([]);
    });

    expect(events).toEqual(['canAfford', 'wait', 'fetch', 'record']);
    expect(run.budget.canAfford).toHaveBeenCalledWith('tradeSymbols', { api: 20 });
  });

  it('sends no second request in one run', async () => {
    const run = freshRun();
    const fetchSymbols = jest.fn(async () => pageOf([]));

    await readSpotSymbols(run, fetchSymbols);

    expect(await readSpotSymbols(run, fetchSymbols)).toBeUndefined();
    expect(fetchSymbols).toHaveBeenCalledTimes(1);
  });

  it('sends no request when the /api/* reading leaves no room for the call', async () => {
    const run = freshRun();
    const fetchSymbols = jest.fn(async () => pageOf([]));

    run.budget.record('market', apiWeightOf(2_981));

    expect(await readSpotSymbols(run, fetchSymbols)).toBeUndefined();
    expect(fetchSymbols).not.toHaveBeenCalled();
  });

  it('sends the request at a reading of 2980, the last that leaves room for the call', async () => {
    const run = freshRun();
    const fetchSymbols = jest.fn(async () => pageOf([]));

    run.budget.record('market', apiWeightOf(2_980));

    expect(await readSpotSymbols(run, fetchSymbols)).toEqual(pageOf([]));
    expect(fetchSymbols).toHaveBeenCalledTimes(1);
  });

  it('records the weight the page reports, so the other lanes judge by it', async () => {
    const run = freshRun();

    await readSpotSymbols(run, async () => ({ ...pageOf([]), usedApiWeight1m: 2_999 }));

    expect(run.budget.canAfford('market', { api: 2 })).toBe(false);
  });

  it.each([
    ['a rate limit', new BinanceRateLimitError(429, 5_000)],
    ['a parse failure', new BinanceHistoryParseError()],
    ['a request failure', new Error('request failed')],
  ])(
    'passes %s on and still counts the call, so a second read sends nothing',
    async (_name, error) => {
      const run = freshRun();
      const failing = jest.fn(async (): Promise<ExchangeSymbolsPage> => {
        throw error;
      });
      const second = jest.fn(async () => pageOf([]));

      await expect(readSpotSymbols(run, failing)).rejects.toBe(error);

      expect(await readSpotSymbols(run, second)).toBeUndefined();
      expect(second).not.toHaveBeenCalled();
    },
  );

  it('keeps the weight reading of the run when a read fails', async () => {
    const run = freshRun();

    run.budget.record('market', apiWeightOf(2_999));

    await readSpotSymbols(run, async () => {
      throw new Error('request failed');
    }).catch(() => undefined);

    expect(run.budget.canAfford('market', { api: 2 })).toBe(false);
  });

  it('reads a padded lower-case coin as its ticker, so it still matches a touched coin, once', async () => {
    const entry = { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: ' btc ', quoteAsset: 'USDT' };
    const fetchImpl = answeringWith({ symbols: [entry, entry] });

    const page = await readSpotSymbols(freshRun(), () => fetchExchangeSymbols({ fetchImpl }));

    expect(
      tradeCandidatesOf({
        touched: new Set(['BTC']),
        trades: EMPTY_TRADES,
        listing: page?.symbols ?? [],
      }),
    ).toEqual([{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' }]);
  });

  it('passes a body with no readable symbol on as a parse error, with no retry in the run', async () => {
    const run = freshRun();
    const fetchImpl = answeringWith({ symbols: [{ symbol: 7 }] });

    await expect(
      readSpotSymbols(run, () => fetchExchangeSymbols({ fetchImpl })),
    ).rejects.toBeInstanceOf(BinanceHistoryParseError);
    expect(run.budget.canAfford('tradeSymbols', { api: 20 })).toBe(false);
  });
});
