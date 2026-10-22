import { BinanceWalkStop } from '@kiko/crypto-sync/exchange/walk';
import { IdCursorPageError } from '@kiko/crypto-sync/exchange/paging';
import type { CoinLists, ExchangeTrades } from '@kiko/crypto-sync/exchange/walk-state';

import {
  bySymbol,
  planTradeSymbolReads,
  readSpotSymbols,
  runTradeSymbolReads,
  TRADE_MAIN_QUOTES,
  tradeCandidatesOf,
  tradesPatchesOf,
  touchedCoinsOf,
  TRADING_SYMBOL_STATUSES,
} from './binance.trade-symbols';
import {
  type BinanceExchangeSymbol,
  BinanceHistoryParseError,
  type ExchangeSymbolsPage,
  fetchExchangeSymbols,
} from './binance.history-client';
import { createBinanceHistoryRun } from './binance.history-budget';
import { BinanceInvalidSymbolError, BinanceRateLimitError } from './binance.client';

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

  it('leaves out a pair of two main quotes when neither coin is touched', () => {
    expect(
      candidatesFrom({
        touched: new Set<string>(),
        listing: [
          listed('ETHBTC', 'TRADING', 'ETH', 'BTC'),
          listed('USDCUSDT', 'TRADING', 'USDC', 'USDT'),
        ],
      }),
    ).toEqual([]);
  });

  it.each([
    ['ETHBTC', 'BTC', 'ETH', 'BTC'],
    ['USDCUSDT', 'USDC', 'USDC', 'USDT'],
  ])('takes %s once %s is touched', (symbol, coin, base, quote) => {
    expect(
      candidatesFrom({
        touched: new Set([coin]),
        listing: [listed(symbol, 'TRADING', base, quote)],
      }),
    ).toEqual([symbol]);
  });

  it('keeps a pair of two main quotes a candidate once a stored fromId makes its coins touched', () => {
    const listing = [listed('ETHBTC', 'TRADING', 'ETH', 'BTC')];
    const trades = tradesOf({ ETHBTC: { fromId: 3 } });
    const touched = touchedCoinsOf({
      holdingAssets: [],
      trades,
      untrackedCoins: NO_COINS,
      oversizedCoins: NO_COINS,
      listing,
    });

    expect(candidatesFrom({ touched, trades, listing })).toEqual(['ETHBTC']);
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

describe('bySymbol', () => {
  it('orders a lower name before a higher one, a higher after a lower, equal names as 0', () => {
    expect(bySymbol({ symbol: 'AAAUSDT' }, { symbol: 'BNBBTC' })).toBeLessThan(0);
    expect(bySymbol({ symbol: 'BNBBTC' }, { symbol: 'AAAUSDT' })).toBeGreaterThan(0);
    expect(bySymbol({ symbol: 'BNBBTC' }, { symbol: 'BNBBTC' })).toBe(0);
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

type ReadEnd = 'short-page' | 'budget' | 'stopped' | 'failed';

const candidateOf = (symbol: string) => ({
  symbol,
  baseAsset: symbol.slice(0, 3),
  quoteAsset: symbol.slice(3),
});

/** Every symbol read and every coin at the text it is read at now, so nothing is due a read. */
const settledWorld = (symbols: string[]) => {
  const candidates = symbols.map(candidateOf);
  const coins = candidates.flatMap(({ baseAsset, quoteAsset }) => [baseAsset, quoteAsset]);
  const texts = Object.fromEntries(coins.map((coin) => [coin, '1/0']));

  return {
    candidates,
    trades: {
      symbols: Object.fromEntries(symbols.map((symbol) => [symbol, { fromId: 1 }])),
      rotation: '',
      balanceSnapshot: texts,
    } satisfies ExchangeTrades,
    balanceTexts: texts,
  };
};

const EIGHT_SYMBOLS = [
  'AAAUSDT',
  'BBBUSDT',
  'CCCUSDT',
  'DDDUSDT',
  'EEEUSDT',
  'FFFUSDT',
  'GGGUSDT',
  'HHHUSDT',
];

describe('planTradeSymbolReads', () => {
  it('puts held first, then never read, then changed, each ascending, ahead of the rest', () => {
    const world = settledWorld(EIGHT_SYMBOLS);
    const { CCCUSDT: _noEntry, ...entries } = world.trades.symbols;

    const plan = planTradeSymbolReads({
      ...world,
      trades: {
        ...world.trades,
        symbols: {
          ...entries,
          HHHUSDT: { fromId: 2, heldOrderId: 7 },
          DDDUSDT: { fromId: 5, heldOrderId: 9 },
          GGGUSDT: { fromId: null },
        },
        balanceSnapshot: { ...world.trades.balanceSnapshot, FFF: '0/0', BBB: '0/0' },
      },
    });

    expect(plan.priority).toEqual([
      'DDDUSDT',
      'HHHUSDT',
      'CCCUSDT',
      'GGGUSDT',
      'BBBUSDT',
      'FFFUSDT',
    ]);
  });

  it('lists a symbol once, in the first class it belongs to', () => {
    const world = settledWorld(['AAAUSDT', 'BBBUSDT']);

    const plan = planTradeSymbolReads({
      ...world,
      trades: {
        ...world.trades,
        symbols: { AAAUSDT: { fromId: null, heldOrderId: 3 }, BBBUSDT: { fromId: null } },
        balanceSnapshot: {},
      },
    });

    expect(plan.priority).toEqual(['AAAUSDT', 'BBBUSDT']);
  });

  it('leaves out of the priority a symbol read whose two coins read the same as stored', () => {
    const world = settledWorld(['BTCETH', 'BTCUSDT']);

    const plan = planTradeSymbolReads({
      ...world,
      trades: { ...world.trades, balanceSnapshot: { BTC: '1/0', ETH: '1/0' } },
    });

    expect(plan.priority).toEqual(['BTCUSDT']);
  });

  it('counts a coin with no stored text as changed', () => {
    const world = settledWorld(['BTCUSDT', 'ETHUSDT']);

    const plan = planTradeSymbolReads({
      ...world,
      trades: { ...world.trades, balanceSnapshot: { BTC: '1/0', USDT: '1/0' } },
    });

    expect(plan.priority).toEqual(['ETHUSDT']);
  });

  it.each([
    ['free moves', '2/0'],
    ['locked moves', '1/1'],
  ])('counts a coin as changed when only its %s', (_name, text) => {
    const world = settledWorld(['BTCUSDT']);

    const plan = planTradeSymbolReads({
      ...world,
      balanceTexts: { ...world.balanceTexts, BTC: text },
    });

    expect(plan.priority).toEqual(['BTCUSDT']);
  });

  it('reads a coin the balance read did not list as 0/0', () => {
    const world = settledWorld(['XYZUSDT']);
    const { XYZ: _unlisted, ...balanceTexts } = world.balanceTexts;
    const zeroStored = {
      ...world.trades,
      balanceSnapshot: { ...world.trades.balanceSnapshot, XYZ: '0/0' },
    };

    expect(planTradeSymbolReads({ ...world, trades: zeroStored, balanceTexts }).priority).toEqual(
      [],
    );
    expect(planTradeSymbolReads({ ...world, balanceTexts }).priority).toEqual(['XYZUSDT']);
  });

  it('runs the round-robin from the first symbol after the stored one, then wraps', () => {
    const world = settledWorld(['AAAUSDT', 'BTCUSDT', 'ETHBTC']);

    const plan = planTradeSymbolReads({
      ...world,
      trades: { ...world.trades, rotation: 'BTCUSDT' },
    });

    expect(plan.roundRobin).toEqual(['ETHBTC', 'AAAUSDT', 'BTCUSDT']);
  });

  it('starts the round-robin at the first symbol when no rotation is stored', () => {
    const world = settledWorld(['AAAUSDT', 'BTCUSDT', 'ETHBTC']);

    expect(planTradeSymbolReads(world).roundRobin).toEqual(['AAAUSDT', 'BTCUSDT', 'ETHBTC']);
  });

  it.each([
    ['a symbol that is not listed, between two', 'BBBUSDT', ['CCCUSDT', 'AAAUSDT']],
    ['a symbol past the last one', 'ZZZUSDT', ['AAAUSDT', 'CCCUSDT']],
    ['a symbol before the first one', '000USDT', ['AAAUSDT', 'CCCUSDT']],
  ])('goes on from a stored rotation naming %s', (_name, rotation, expected) => {
    const world = settledWorld(['AAAUSDT', 'CCCUSDT']);

    const plan = planTradeSymbolReads({ ...world, trades: { ...world.trades, rotation } });

    expect(plan.roundRobin).toEqual(expected);
  });

  it('offers the round-robin every symbol, so one the priority left unread is still reached', () => {
    const world = settledWorld(['AAAUSDT', 'BBBUSDT']);

    const plan = planTradeSymbolReads({
      ...world,
      trades: { ...world.trades, balanceSnapshot: {} },
    });

    expect(plan.priority).toEqual(['AAAUSDT', 'BBBUSDT']);
    expect(plan.roundRobin).toEqual(['AAAUSDT', 'BBBUSDT']);
  });

  it('plans nothing for no candidates', () => {
    expect(planTradeSymbolReads(settledWorld([]))).toEqual({ priority: [], roundRobin: [] });
  });
});

/** A lane of `cap` calls: a read is afforded while `keep` calls would still be left after it. */
const laneOf = (cap: number) => {
  const state = { spent: 0 };

  return { state, canAfford: (keep: number) => state.spent + keep < cap };
};

/** A reader that wants `wanted` calls of the lane and stops where it cannot afford another. */
const pagingReader =
  (lane: ReturnType<typeof laneOf>, wanted: (symbol: string) => number, spentBy: string[]) =>
  async (symbol: string, keep: number): Promise<{ ended: ReadEnd }> => {
    let calls = 0;

    while (calls < wanted(symbol) && lane.canAfford(keep)) {
      lane.state.spent += 1;
      calls += 1;
      spentBy.push(symbol);
    }

    return { ended: calls < wanted(symbol) ? 'budget' : 'short-page' };
  };

const recordingReader = (end: ReadEnd = 'short-page') => {
  const reads: [string, number][] = [];

  return {
    reads,
    readSymbol: async (symbol: string, keep: number): Promise<{ ended: ReadEnd }> => {
      reads.push([symbol, keep]);

      return { ended: end };
    },
  };
};

describe('runTradeSymbolReads', () => {
  it('reads the priority first and the round-robin after it, each symbol once', async () => {
    const reader = recordingReader();

    await runTradeSymbolReads({
      plan: { priority: ['CCC', 'AAA'], roundRobin: ['BBB', 'AAA', 'CCC', 'DDD'] },
      canAfford: () => true,
      readSymbol: reader.readSymbol,
    });

    expect(reader.reads).toEqual([
      ['CCC', 1],
      ['AAA', 1],
      ['BBB', 0],
      ['DDD', 0],
    ]);
  });

  it('moves the rotation to the last round-robin symbol read, never to a priority one', async () => {
    const result = await runTradeSymbolReads({
      plan: { priority: ['CCC'], roundRobin: ['BBB', 'AAA', 'CCC'] },
      canAfford: () => true,
      readSymbol: recordingReader().readSymbol,
    });

    expect(result.rotation).toBe('AAA');
  });

  it('leaves the rotation unset when no round-robin symbol was read', async () => {
    const result = await runTradeSymbolReads({
      plan: { priority: ['CCC'], roundRobin: ['CCC'] },
      canAfford: () => true,
      readSymbol: recordingReader().readSymbol,
    });

    expect(result).toEqual({
      rotation: undefined,
      ended: { CCC: 'short-page' },
      symbolFailures: [],
      failure: undefined,
    });
  });

  it.each<ReadEnd>(['short-page', 'budget', 'stopped'])(
    'moves the rotation past a round-robin read that ended %s',
    async (end) => {
      const result = await runTradeSymbolReads({
        plan: { priority: [], roundRobin: ['AAA'] },
        canAfford: () => true,
        readSymbol: recordingReader(end).readSymbol,
      });

      expect(result).toEqual({
        rotation: 'AAA',
        ended: { AAA: end },
        symbolFailures: [],
        failure: undefined,
      });
    },
  );

  it('keeps one call for the round-robin: five calls and nine changed symbols give four priority reads', async () => {
    const world = settledWorld([...EIGHT_SYMBOLS, 'IIIUSDT']);
    const plan = planTradeSymbolReads({
      ...world,
      trades: { ...world.trades, balanceSnapshot: {} },
    });
    const lane = laneOf(5);
    const reader = recordingReader();

    const result = await runTradeSymbolReads({
      plan,
      canAfford: lane.canAfford,
      readSymbol: async (symbol, keep) => {
        lane.state.spent += 1;

        return reader.readSymbol(symbol, keep);
      },
    });

    expect(reader.reads).toEqual([
      ['AAAUSDT', 1],
      ['BBBUSDT', 1],
      ['CCCUSDT', 1],
      ['DDDUSDT', 1],
      ['EEEUSDT', 0],
    ]);
    expect(result.rotation).toBe('EEEUSDT');
  });

  it('hands a held symbol the reserved call, so its re-read leaves one call of the lane', async () => {
    const lane = laneOf(5);
    const spentBy: string[] = [];

    await runTradeSymbolReads({
      plan: { priority: ['HELD'], roundRobin: ['HELD', 'NEXT'] },
      canAfford: lane.canAfford,
      readSymbol: pagingReader(lane, (symbol) => (symbol === 'HELD' ? 50 : 1), spentBy),
    });

    expect(spentBy).toEqual(['HELD', 'HELD', 'HELD', 'HELD', 'NEXT']);
  });

  it('starts no priority read when only the reserved call is left, and still reads the round-robin', async () => {
    const lane = laneOf(1);
    const reader = recordingReader();

    await runTradeSymbolReads({
      plan: { priority: ['BBB'], roundRobin: ['AAA', 'BBB'] },
      canAfford: lane.canAfford,
      readSymbol: async (symbol, keep) => {
        lane.state.spent += 1;

        return reader.readSymbol(symbol, keep);
      },
    });

    expect(reader.reads).toEqual([['AAA', 0]]);
  });

  it('keeps the rotation the round-robin reached when a later read throws, and hands the error back', async () => {
    const rateLimit = new BinanceRateLimitError(429, 5_000);
    const started: string[] = [];

    const result = await runTradeSymbolReads({
      plan: { priority: [], roundRobin: ['AAA', 'BBB', 'CCC'] },
      canAfford: () => true,
      readSymbol: async (symbol) => {
        started.push(symbol);

        if (symbol === 'BBB') {
          throw rateLimit;
        }

        return { ended: 'short-page' };
      },
    });

    expect(result).toEqual({
      rotation: 'AAA',
      ended: { AAA: 'short-page' },
      symbolFailures: [],
      failure: { error: rateLimit },
    });
    expect(started).toEqual(['AAA', 'BBB']);
  });

  it('leaves the rotation where it was when a priority read throws', async () => {
    const failure = new Error('request failed');

    const result = await runTradeSymbolReads({
      plan: { priority: ['AAA'], roundRobin: ['AAA', 'BBB'] },
      canAfford: () => true,
      readSymbol: async () => {
        throw failure;
      },
    });

    expect(result).toEqual({
      rotation: undefined,
      ended: {},
      symbolFailures: [],
      failure: { error: failure },
    });
  });

  it('keeps the symbol failures and the progress made before a later read stops the run', async () => {
    const parseFailure = new BinanceHistoryParseError();
    const rateLimit = new BinanceRateLimitError(418, 5_000);

    const result = await runTradeSymbolReads({
      plan: { priority: [], roundRobin: ['AAA', 'BBB', 'CCC'] },
      canAfford: () => true,
      readSymbol: async (symbol) => {
        if (symbol === 'AAA') {
          throw parseFailure;
        }

        if (symbol === 'CCC') {
          throw rateLimit;
        }

        return { ended: 'short-page' };
      },
    });

    expect(result).toEqual({
      rotation: 'BBB',
      ended: { AAA: 'failed', BBB: 'short-page' },
      symbolFailures: [{ symbol: 'AAA', error: parseFailure }],
      failure: { error: rateLimit },
    });
  });

  it.each([
    ['a rate limit', new BinanceRateLimitError(429, 5_000)],
    ['an IP ban', new BinanceRateLimitError(418, 5_000)],
    ['a request failure of another code', new Error('Binance request failed: 400: Bad key')],
    ['a network failure', new TypeError('Network request failed')],
  ])('stops the run at %s, with the symbols after it unread', async (_name, error) => {
    const reader = recordingReader();

    const result = await runTradeSymbolReads({
      plan: { priority: [], roundRobin: ['AAA', 'BBB', 'CCC'] },
      canAfford: () => true,
      readSymbol: async (symbol, keep) => {
        if (symbol === 'BBB') {
          throw error;
        }

        return reader.readSymbol(symbol, keep);
      },
    });

    expect(result).toEqual({
      rotation: 'AAA',
      ended: { AAA: 'short-page' },
      symbolFailures: [],
      failure: { error },
    });
    expect(reader.reads).toEqual([['AAA', 0]]);
  });

  describe.each([
    ['an id cursor page the pager cannot trust', new IdCursorPageError('not-safe-integer')],
    ['a body that does not parse', new BinanceHistoryParseError()],
    ['a symbol Binance does not know (-1121)', new BinanceInvalidSymbolError('Invalid symbol.')],
    ['a row the rules refuse', new BinanceWalkStop('amount-malformed')],
  ])('with %s', (_name, error) => {
    it('ends only that symbol as failed, and reads the next one', async () => {
      const reader = recordingReader();

      const result = await runTradeSymbolReads({
        plan: { priority: [], roundRobin: ['AAA', 'BBB', 'CCC'] },
        canAfford: () => true,
        readSymbol: async (symbol, keep) => {
          if (symbol === 'BBB') {
            throw error;
          }

          return reader.readSymbol(symbol, keep);
        },
      });

      expect(result).toEqual({
        rotation: 'CCC',
        ended: { AAA: 'short-page', BBB: 'failed', CCC: 'short-page' },
        symbolFailures: [{ symbol: 'BBB', error }],
        failure: undefined,
      });
      expect(reader.reads).toEqual([
        ['AAA', 0],
        ['CCC', 0],
      ]);
    });

    it('lets the rotation pass a round-robin symbol that failed, and no priority one', async () => {
      const failing = async (): Promise<{ ended: ReadEnd }> => {
        throw error;
      };

      const roundRobin = await runTradeSymbolReads({
        plan: { priority: [], roundRobin: ['AAA'] },
        canAfford: () => true,
        readSymbol: failing,
      });
      const priority = await runTradeSymbolReads({
        plan: { priority: ['AAA'], roundRobin: [] },
        canAfford: () => true,
        readSymbol: failing,
      });

      expect(roundRobin.rotation).toBe('AAA');
      expect(priority.rotation).toBeUndefined();
    });

    it('reads a priority symbol that failed once only, not again in the round-robin', async () => {
      const reader = recordingReader();

      const result = await runTradeSymbolReads({
        plan: { priority: ['AAA'], roundRobin: ['AAA', 'BBB'] },
        canAfford: () => true,
        readSymbol: async (symbol, keep) => {
          if (symbol === 'AAA') {
            throw error;
          }

          return reader.readSymbol(symbol, keep);
        },
      });

      expect(result.ended).toEqual({ AAA: 'failed', BBB: 'short-page' });
      expect(reader.reads).toEqual([['BBB', 0]]);
    });

    it('leaves the coins of the failed symbol unfinished, so no snapshot takes their text', async () => {
      const candidates = ['AAAUSDT', 'BBBUSDT'].map(candidateOf);
      const result = await runTradeSymbolReads({
        plan: { priority: [], roundRobin: ['AAAUSDT', 'BBBUSDT'] },
        canAfford: () => true,
        readSymbol: async (symbol) => {
          if (symbol === 'AAAUSDT') {
            throw error;
          }

          return { ended: 'short-page' };
        },
      });

      expect(
        tradesPatchesOf({
          candidates,
          trades: { symbols: {}, rotation: '', balanceSnapshot: { AAA: 'old/0', USDT: 'old/0' } },
          balanceTexts: { AAA: '1/0', BBB: '2/0', USDT: '9/0' },
          result,
        }),
      ).toEqual([
        { kind: 'tradesRotation', value: 'BBBUSDT' },
        { kind: 'tradesBalanceSnapshot', value: { AAA: 'old/0', USDT: 'old/0', BBB: '2/0' } },
      ]);
    });
  });
});

describe('tradesPatchesOf', () => {
  const stored = (balanceSnapshot: Record<string, string>): ExchangeTrades => ({
    symbols: {},
    rotation: '',
    balanceSnapshot,
  });

  const THREE = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'].map(candidateOf);

  const TEXTS = { AAA: '1/0', BBB: '2/0', CCC: '3/0', USDT: '9/0' };

  it('writes the rotation a round-robin read reached, and none when it reached none', () => {
    const base = { candidates: THREE, trades: stored({}), balanceTexts: TEXTS };

    expect(tradesPatchesOf({ ...base, result: { rotation: 'BBBUSDT', ended: {} } })).toEqual([
      { kind: 'tradesRotation', value: 'BBBUSDT' },
    ]);
    expect(tradesPatchesOf({ ...base, result: { rotation: undefined, ended: {} } })).toEqual([]);
  });

  it('keeps the text of a coin while one of its symbols has not ended at a short page', () => {
    const patches = tradesPatchesOf({
      candidates: THREE,
      trades: stored({ USDT: 'old/0', CCC: 'old/0' }),
      balanceTexts: TEXTS,
      result: {
        rotation: undefined,
        ended: { AAAUSDT: 'short-page', BBBUSDT: 'short-page', CCCUSDT: 'budget' },
      },
    });

    expect(patches).toEqual([
      {
        kind: 'tradesBalanceSnapshot',
        value: { USDT: 'old/0', CCC: 'old/0', AAA: '1/0', BBB: '2/0' },
      },
    ]);
  });

  it('takes the new text of a coin once every symbol of it ended at a short page', () => {
    const patches = tradesPatchesOf({
      candidates: THREE,
      trades: stored({ USDT: 'old/0', CCC: 'old/0' }),
      balanceTexts: TEXTS,
      result: {
        rotation: undefined,
        ended: { AAAUSDT: 'short-page', BBBUSDT: 'short-page', CCCUSDT: 'short-page' },
      },
    });

    expect(patches).toEqual([
      {
        kind: 'tradesBalanceSnapshot',
        value: { USDT: '9/0', CCC: '3/0', AAA: '1/0', BBB: '2/0' },
      },
    ]);
  });

  it('keeps the stored text of a coin whose symbols were not read at all', () => {
    const patches = tradesPatchesOf({
      candidates: THREE,
      trades: stored({ AAA: 'old/0', USDT: 'old/0' }),
      balanceTexts: TEXTS,
      result: { rotation: undefined, ended: { BBBUSDT: 'short-page' } },
    });

    expect(patches).toEqual([
      { kind: 'tradesBalanceSnapshot', value: { AAA: 'old/0', USDT: 'old/0', BBB: '2/0' } },
    ]);
  });

  it.each<ReadEnd>(['budget', 'stopped', 'failed'])(
    'does not take the text of a coin whose symbol ended %s',
    (end) => {
      const patches = tradesPatchesOf({
        candidates: [candidateOf('AAAUSDT')],
        trades: stored({}),
        balanceTexts: TEXTS,
        result: { rotation: undefined, ended: { AAAUSDT: end } },
      });

      expect(patches).toEqual([]);
    },
  );

  it('keeps the entry of a coin that no candidate names', () => {
    const patches = tradesPatchesOf({
      candidates: [candidateOf('AAAUSDT')],
      trades: stored({ OLD: '5/0' }),
      balanceTexts: TEXTS,
      result: { rotation: undefined, ended: { AAAUSDT: 'short-page' } },
    });

    expect(patches).toEqual([
      { kind: 'tradesBalanceSnapshot', value: { OLD: '5/0', AAA: '1/0', USDT: '9/0' } },
    ]);
  });

  it('writes a coin the balance read did not list as 0/0', () => {
    const patches = tradesPatchesOf({
      candidates: [candidateOf('AAAUSDT')],
      trades: stored({}),
      balanceTexts: {},
      result: { rotation: undefined, ended: { AAAUSDT: 'short-page' } },
    });

    expect(patches).toEqual([
      { kind: 'tradesBalanceSnapshot', value: { AAA: '0/0', USDT: '0/0' } },
    ]);
  });

  it('writes no snapshot when every coin that qualifies already holds its text', () => {
    const patches = tradesPatchesOf({
      candidates: [candidateOf('AAAUSDT')],
      trades: stored({ AAA: '1/0', USDT: '9/0' }),
      balanceTexts: TEXTS,
      result: { rotation: undefined, ended: { AAAUSDT: 'short-page' } },
    });

    expect(patches).toEqual([]);
  });

  it('writes the rotation before the snapshot', () => {
    const patches = tradesPatchesOf({
      candidates: [candidateOf('AAAUSDT')],
      trades: stored({}),
      balanceTexts: TEXTS,
      result: { rotation: 'AAAUSDT', ended: { AAAUSDT: 'short-page' } },
    });

    expect(patches.map(({ kind }) => kind)).toEqual(['tradesRotation', 'tradesBalanceSnapshot']);
  });
});
