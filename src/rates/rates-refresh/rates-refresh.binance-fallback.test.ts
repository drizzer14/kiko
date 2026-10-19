import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';
import type { CryptoCurrency, Currency } from '@kiko/currency/currency';

import type { RateEntry } from '../conversion';
import { createBinanceMarketClient } from '../binance-market';
import { guardedBreakdown, guardedNetWorth, buildRateTable } from '../net-worth-view';

import { type RefreshDeps, refreshRates } from './rates-refresh';

type StoredRate = { base: string; quote: string; rate: string; source: string; fetchedAt: number };

type Reply = {
  status?: number;
  price?: string;
  /** How many days before today the last candle opened; a pair that stopped trading is older. */
  openedDaysAgo?: number;
  headers?: Record<string, string>;
  throws?: boolean;
  body?: unknown;
};

const NOW = 1000;
const TODAY = Math.floor(NOW / DAY_MS) * DAY_MS;

const fiat: RateEntry[] = [
  { base: 'USD', quote: 'UAH', rate: 40, source: 'monobank' },
  { base: 'EUR', quote: 'UAH', rate: 43, source: 'monobank' },
];

const coinGeckoAnswering =
  (rates: Partial<Record<CryptoCurrency, number>>) =>
  async (currencies: CryptoCurrency[]): Promise<RateEntry[]> =>
    currencies.flatMap(
      (base): RateEntry[] =>
        foldMap(maybe(rates[base]), (rate): RateEntry[] => [
          { base, quote: 'USD', rate, source: 'coingecko' },
        ]) ?? [],
    );

const binanceFetchOf = (replies: Record<string, Reply>) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const symbol = url.split('symbol=')[1]?.split('&')[0] ?? '';
    const reply = replies[symbol] ?? { status: 400 };

    if (reply.throws) {
      throw new TypeError('offline');
    }
    const status = reply.status ?? 200;

    return {
      ok: status === 200,
      status,
      headers: new Headers(reply.headers),
      json: async () =>
        reply.body ??
        (reply.price === undefined
          ? { code: -1121 }
          : [[TODAY - (reply.openedDaysAgo ?? 0) * DAY_MS, '0', '0', '0', reply.price]]),
    };
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
};

let keyCounter = 0;

const run = async (input: {
  held: CryptoCurrency[];
  coinGecko: Partial<Record<CryptoCurrency, number>>;
  binance: Record<string, Reply>;
  overrides?: Partial<RefreshDeps>;
  cooldownKey?: string;
}) => {
  const captured: StoredRate[][] = [];
  keyCounter += 1;
  const binance = binanceFetchOf(input.binance);
  const deps: RefreshDeps = {
    fetchFiatRates: async () => fiat,
    fetchNbuRates: async () => [],
    fetchCryptoPrices: coinGeckoAnswering(input.coinGecko),
    openCurrencies: async () => ({
      needsFiat: true,
      cryptoCurrencies: input.held,
      nonBaseCurrencies: ['USD', 'EUR', ...input.held],
    }),
    presentCurrencies: async () => [],
    upsertMany: async (rates: StoredRate[]) => {
      captured.push(rates);
    },
    now: () => NOW,
    sleep: async () => {},
    binanceMarket: createBinanceMarketClient({
      fetchImpl: binance.fetchImpl,
      now: () => NOW,
      sleep: async () => {},
      cooldownKey: input.cooldownKey ?? `rates-refresh-binance-fallback-${keyCounter}`,
    }),
    ...input.overrides,
  };
  const outcome = await refreshRates(deps);
  const rows = captured.flat();

  return { binance, outcome, rows, rowOf: (base: string) => rows.find((row) => row.base === base) };
};

describe('refreshRates — the Binance public price fallback', () => {
  it("prices a coin CoinGecko missed through its USDT symbol and USDT's price", async () => {
    const { rowOf, binance } = await run({
      held: ['BTC', 'ETH', 'USDT'],
      coinGecko: { BTC: 65_000, USDT: 1.0007 },
      binance: { ETHUSDT: { price: '3000.00000000' } },
    });

    expect(rowOf('ETH')).toEqual({
      base: 'ETH',
      quote: 'UAH',
      rate: String(3_000 * (1.0007 * 40)),
      source: 'binance',
      fetchedAt: NOW,
    });
    expect(rowOf('BTC')?.source).toBe('coingecko');
    expect(rowOf('USDT')?.source).toBe('coingecko');
    expect(binance.calls.map((call) => call.url)).toEqual([
      'https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1d&limit=1',
    ]);
  });

  it('prices USDT through EURUSDT and the EUR anchor when USDT is unpriced', async () => {
    const { rowOf, binance } = await run({
      held: ['BTC', 'USDT'],
      coinGecko: { BTC: 65_000 },
      binance: { EURUSDT: { price: '1.08000000' } },
    });

    expect(rowOf('USDT')).toEqual({
      base: 'USDT',
      quote: 'UAH',
      rate: String(43 / 1.08),
      source: 'binance',
      fetchedAt: NOW,
    });
    expect(binance.calls.map((call) => call.url)).toEqual([
      'https://api.binance.com/api/v3/klines?symbol=EURUSDT&interval=1d&limit=1',
    ]);
  });

  it('never assumes 1:1: a stablecoin is its market price times the derived USDT price', async () => {
    const { rowOf } = await run({
      held: ['USDC', 'USDT'],
      coinGecko: {},
      binance: { EURUSDT: { price: '1.08' }, USDCUSDT: { price: '0.9996' } },
    });

    const usdtInUah = 43 / 1.08;

    expect(rowOf('USDT')?.rate).toBe(String(usdtInUah));
    expect(rowOf('USDC')?.rate).toBe(String(0.9996 * usdtInUah));
    expect(rowOf('USDT')?.rate).not.toBe('40');
    expect(rowOf('USDC')?.rate).not.toBe('40');
  });

  it('writes no stablecoin row when USDT cannot be priced, rather than assuming 1:1', async () => {
    const { rows } = await run({
      held: ['USDC', 'USDT'],
      coinGecko: {},
      binance: { EURUSDT: { status: 451 }, USDCUSDT: { price: '0.9996' } },
    });

    expect(rows.map((row) => row.base)).toEqual(['USD', 'EUR']);
  });

  it('keeps a coin both sources missed out of net worth, and the priced ones in', async () => {
    const { rows } = await run({
      held: ['BTC', 'ETH', 'SOL'],
      coinGecko: { BTC: 65_000 },
      binance: { SOLUSDT: { price: '150' }, EURUSDT: { price: '1.08' } },
    });
    const table = buildRateTable(
      rows.map((row) => ({
        base: row.base as Currency,
        quote: row.quote as Currency,
        rate: row.rate,
      })),
    );
    const crypto = (currency: 'BTC' | 'ETH' | 'SOL') => ({
      id: currency,
      currency,
      balanceMinorUnits: 100_000_000,
      type: 'crypto_asset' as const,
      metadata: null,
    });
    const holdings = [crypto('BTC'), crypto('ETH'), crypto('SOL')];

    expect(rows.map((row) => row.base)).not.toContain('ETH');
    expect(guardedBreakdown(holdings, 'UAH', table, 0).map((money) => money.currency)).toEqual([
      'BTC',
      'SOL',
    ]);
    expect(guardedNetWorth([crypto('ETH')], 'UAH', table, 0).minorUnits).toBe(0);
  });

  it('asks Binance nothing when CoinGecko priced every held coin', async () => {
    const { binance } = await run({
      held: ['BTC', 'ETH'],
      coinGecko: { BTC: 65_000, ETH: 3_200 },
      binance: {},
    });

    expect(binance.calls).toEqual([]);
  });

  it('asks Binance nothing when no coin is held', async () => {
    const { binance } = await run({ held: [], coinGecko: {}, binance: {} });

    expect(binance.calls).toEqual([]);
  });

  it('sends only the market symbol: no key header and no signed query', async () => {
    const { binance } = await run({
      held: ['ETH', 'SOL', 'USDT'],
      coinGecko: {},
      binance: {
        ETHUSDT: { price: '3000' },
        SOLUSDT: { price: '150' },
        EURUSDT: { price: '1.08' },
      },
    });

    expect(binance.calls).toHaveLength(3);

    for (const call of binance.calls) {
      expect(call.url).toMatch(
        /^https:\/\/api\.binance\.com\/api\/v3\/klines\?symbol=\w+&interval=1d&limit=1$/,
      );
      expect(JSON.stringify(call.init ?? {}).toLowerCase()).not.toContain('apikey');
    }
  });

  it('prices every held coin through the fallback when the whole CoinGecko leg failed', async () => {
    const { rowOf, outcome } = await run({
      held: ['BTC', 'USDT'],
      coinGecko: {},
      binance: { EURUSDT: { price: '1.08' }, BTCUSDT: { price: '60000' } },
      overrides: {
        fetchCryptoPrices: async () => {
          throw new Error('CoinGecko request failed: 429');
        },
      },
    });

    expect(rowOf('BTC')?.rate).toBe(String(60_000 * (43 / 1.08)));
    expect(outcome).toEqual({ state: 'partial', failedLegs: ['crypto'] });
  });

  it('asks Binance nothing when there is no fiat anchor to price USDT through', async () => {
    const { binance, rows } = await run({
      held: ['ETH'],
      coinGecko: {},
      binance: { ETHUSDT: { price: '3000' } },
      overrides: {
        fetchFiatRates: async () => {
          throw new Error('Monobank down');
        },
      },
    });

    expect(binance.calls).toEqual([]);
    expect(rows).toEqual([]);
  });

  describe.each([451, 403, 418, 429])('HTTP %i from Binance', (status) => {
    it('leaves that coin unpriced and fails nothing else', async () => {
      const { rows, outcome, rowOf } = await run({
        held: ['BTC', 'ETH'],
        coinGecko: { BTC: 65_000 },
        binance: { ETHUSDT: { status, headers: { 'Retry-After': '30' } } },
      });

      expect(outcome).toEqual({ state: 'refreshed', failedLegs: [] });
      expect(rowOf('ETH')).toBeUndefined();
      expect(rowOf('BTC')?.rate).toBe(String(65_000 * 40));
      expect(rows.map((row) => row.base)).toEqual(['USD', 'EUR', 'BTC']);
    });
  });

  it.each([418, 429])(
    'makes exactly one request for the whole refresh after an HTTP %i, however many coins miss',
    async (status) => {
      const { binance } = await run({
        held: ['ETH', 'SOL', 'XRP'],
        coinGecko: {},
        binance: {
          EURUSDT: { status, headers: { 'Retry-After': '30' } },
          ETHUSDT: { price: '3000' },
        },
      });

      expect(binance.calls).toHaveLength(1);
    },
  );

  it('makes one request, not a retry loop, after a 429 on a coin symbol', async () => {
    const { binance } = await run({
      held: ['BTC', 'ETH', 'SOL', 'USDT'],
      coinGecko: { BTC: 65_000, USDT: 1 },
      binance: { ETHUSDT: { status: 429 }, SOLUSDT: { price: '150' } },
    });

    expect(binance.calls.map((call) => call.url)).toEqual([
      'https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1d&limit=1',
    ]);
  });

  it('asks nothing in a later refresh until the Retry-After of a 429 has passed', async () => {
    const key = 'rates-refresh-binance-fallback-retry-after';
    await run({
      held: ['ETH', 'USDT'],
      coinGecko: { USDT: 1 },
      binance: { ETHUSDT: { status: 429, headers: { 'Retry-After': '30' } } },
      cooldownKey: key,
    });

    const duringCooldown = await run({
      held: ['ETH', 'USDT'],
      coinGecko: { USDT: 1 },
      binance: { ETHUSDT: { price: '3000' } },
      cooldownKey: key,
    });

    expect(duringCooldown.binance.calls).toEqual([]);
    expect(duringCooldown.rowOf('ETH')).toBeUndefined();

    const afterCooldownFetch = binanceFetchOf({ ETHUSDT: { price: '3000' } });
    const afterCooldown = await run({
      held: ['ETH', 'USDT'],
      coinGecko: { USDT: 1 },
      binance: {},
      cooldownKey: key,
      overrides: {
        now: () => NOW + 30_000,
        binanceMarket: createBinanceMarketClient({
          fetchImpl: afterCooldownFetch.fetchImpl,
          now: () => NOW + 30_000,
          sleep: async () => {},
          cooldownKey: key,
        }),
      },
    });

    expect(afterCooldownFetch.calls).toHaveLength(1);
    expect(afterCooldown.rowOf('ETH')?.source).toBe('binance');
  });

  it('builds its own market client on the clock and the sleep of the refresh', async () => {
    const binance = binanceFetchOf({
      ETHUSDT: { price: '3000.00000000' },
      SOLUSDT: { price: '150.00000000' },
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(binance.fetchImpl);
    const sleep = jest.fn(async (_milliseconds: number) => undefined);

    try {
      const { rowOf } = await run({
        held: ['ETH', 'SOL', 'USDT'],
        coinGecko: { USDT: 1.0007 },
        binance: {},
        overrides: { binanceMarket: undefined, sleep },
      });

      expect(rowOf('ETH')?.source).toBe('binance');
      expect(rowOf('ETH')?.rate).toBe(String(3_000 * (1.0007 * 40)));
      expect(rowOf('SOL')?.source).toBe('binance');
      expect(sleep).toHaveBeenCalledWith(350);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it.each([
    ['30 days old (a halted pair)', 30],
    ['of yesterday', 1],
  ])(
    'writes no row for a coin whose last candle is %s, never its last trade stamped as now',
    async (_label, openedDaysAgo) => {
      const { outcome, rowOf } = await run({
        held: ['BTC', 'ETH', 'USDT'],
        coinGecko: { BTC: 65_000, USDT: 1 },
        binance: { ETHUSDT: { price: '3000', openedDaysAgo } },
      });

      expect(outcome).toEqual({ state: 'refreshed', failedLegs: [] });
      expect(rowOf('ETH')).toBeUndefined();
      expect(rowOf('BTC')).toBeDefined();
    },
  );

  it('prices a coin from the close of its candle of today', async () => {
    const { rowOf } = await run({
      held: ['BTC', 'ETH', 'USDT'],
      coinGecko: { BTC: 65_000, USDT: 1 },
      binance: { ETHUSDT: { price: '3100.5', openedDaysAgo: 0 } },
    });

    expect(rowOf('ETH')).toEqual({
      base: 'ETH',
      quote: 'UAH',
      rate: String(3_100.5 * 40),
      source: 'binance',
      fetchedAt: NOW,
    });
  });

  it('writes no stablecoin row when the EURUSDT that prices USDT has halted', async () => {
    const { rows } = await run({
      held: ['USDC', 'USDT'],
      coinGecko: {},
      binance: {
        EURUSDT: { price: '1.08', openedDaysAgo: 30 },
        USDCUSDT: { price: '0.9996' },
      },
    });

    expect(rows.map((row) => row.base)).toEqual(['USD', 'EUR']);
  });

  it.each([
    ['a network error', { throws: true }],
    ['an unlisted symbol', { status: 400 }],
    ['a malformed body', { body: ['not', 'a', 'price'] }],
    ['a zero price', { price: '0' }],
  ] satisfies [string, Reply][])('leaves the coin unpriced on %s', async (_label, reply) => {
    const { outcome, rowOf } = await run({
      held: ['BTC', 'ETH'],
      coinGecko: { BTC: 65_000 },
      binance: { ETHUSDT: reply },
    });

    expect(outcome).toEqual({ state: 'refreshed', failedLegs: [] });
    expect(rowOf('ETH')).toBeUndefined();
    expect(rowOf('BTC')).toBeDefined();
  });
});
