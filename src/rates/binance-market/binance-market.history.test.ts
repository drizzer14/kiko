import { DAY_MS } from '@kiko/dates';

import { fetchFallbackHistory } from './binance-market.history';
import type { BinanceMarketClient, DailyClose } from './binance-market.client';

const DAY_ONE = Date.UTC(2026, 8, 1);
const day = (index: number) => DAY_ONE + index * DAY_MS;

const clientOf = (series: Record<string, DailyClose[] | undefined>) => {
  const asked: { symbol: string; start: number; end: number }[] = [];
  const client: BinanceMarketClient = {
    currentPrice: async () => undefined,
    dailyCloses: async (symbol, start, end) => {
      asked.push({ symbol, start, end });

      return series[symbol];
    },
  };

  return { asked, client };
};

const closes = (...values: number[]): DailyClose[] =>
  values.map((close, index) => ({ day: day(index), close }));

const NO_ANCHOR = () => undefined;

const euroLoader = (priceAt: (at: number) => number | undefined) => {
  const loads = jest.fn(async () => priceAt);

  return loads;
};

describe('fetchFallbackHistory', () => {
  it("prices each day of a coin's series through USDT's own price that day", async () => {
    const { asked, client } = clientOf({ ETHUSDT: closes(3_000, 3_100) });

    const entries = await fetchFallbackHistory({
      coins: ['ETH'],
      start: day(0),
      end: day(1),
      usdtPriceAt: (at) => (at === day(0) ? 40 : 41),
      loadEuroPriceAt: euroLoader(NO_ANCHOR),
      client,
    });

    expect(entries).toEqual([
      { base: 'ETH', quote: 'UAH', day: day(0), rate: 3_000 * 40, source: 'binance' },
      { base: 'ETH', quote: 'UAH', day: day(1), rate: 3_100 * 41, source: 'binance' },
    ]);
    expect(asked).toEqual([{ symbol: 'ETHUSDT', start: day(0), end: day(1) }]);
  });

  it('prices through EURUSDT and the EUR anchor of each day when USDT has no price', async () => {
    const { asked, client } = clientOf({
      ETHUSDT: closes(3_000, 3_100),
      EURUSDT: closes(1.08, 1.1),
    });

    const entries = await fetchFallbackHistory({
      coins: ['ETH'],
      start: day(0),
      end: day(1),
      usdtPriceAt: NO_ANCHOR,
      loadEuroPriceAt: euroLoader((at) => (at === day(0) ? 43 : 44)),
      client,
    });

    expect(entries).toEqual([
      { base: 'ETH', quote: 'UAH', day: day(0), rate: 3_000 * (43 / 1.08), source: 'binance' },
      { base: 'ETH', quote: 'UAH', day: day(1), rate: 3_100 * (44 / 1.1), source: 'binance' },
    ]);
    expect(asked.map((call) => call.symbol)).toEqual(['ETHUSDT', 'EURUSDT']);
  });

  it('prices USDT itself through EURUSDT and the EUR anchor, with no USDT symbol', async () => {
    const { asked, client } = clientOf({ EURUSDT: closes(1.08, 1.1) });

    const entries = await fetchFallbackHistory({
      coins: ['USDT'],
      start: day(0),
      end: day(1),
      usdtPriceAt: NO_ANCHOR,
      loadEuroPriceAt: euroLoader(() => 43),
      client,
    });

    expect(entries).toEqual([
      { base: 'USDT', quote: 'UAH', day: day(0), rate: 43 / 1.08, source: 'binance' },
      { base: 'USDT', quote: 'UAH', day: day(1), rate: 43 / 1.1, source: 'binance' },
    ]);
    expect(asked.map((call) => call.symbol)).toEqual(['EURUSDT']);
  });

  it('never assumes 1:1 for a stablecoin: its candle times the USDT price of the day', async () => {
    const { client } = clientOf({ USDCUSDT: closes(0.9996), EURUSDT: closes(1.08) });

    const entries = await fetchFallbackHistory({
      coins: ['USDC'],
      start: day(0),
      end: day(0),
      usdtPriceAt: NO_ANCHOR,
      loadEuroPriceAt: euroLoader(() => 43),
      client,
    });

    expect(entries).toEqual([
      { base: 'USDC', quote: 'UAH', day: day(0), rate: 0.9996 * (43 / 1.08), source: 'binance' },
    ]);
  });

  it('leaves out a day with no USDT price from either source, never pricing it 1:1', async () => {
    const { client } = clientOf({ ETHUSDT: closes(3_000, 3_100), EURUSDT: closes(1.08, 1.1) });

    const entries = await fetchFallbackHistory({
      coins: ['ETH'],
      start: day(0),
      end: day(1),
      usdtPriceAt: NO_ANCHOR,
      loadEuroPriceAt: euroLoader((at) => (at === day(1) ? 44 : undefined)),
      client,
    });

    expect(entries).toEqual([
      { base: 'ETH', quote: 'UAH', day: day(1), rate: 3_100 * (44 / 1.1), source: 'binance' },
    ]);
  });

  it('asks no EURUSDT and loads no EUR when USDT has a price on every day of the series', async () => {
    const { asked, client } = clientOf({ ETHUSDT: closes(3_000) });
    const loadEuro = euroLoader(() => 43);

    await fetchFallbackHistory({
      coins: ['ETH'],
      start: day(0),
      end: day(0),
      usdtPriceAt: () => 40,
      loadEuroPriceAt: loadEuro,
      client,
    });

    expect(asked.map((call) => call.symbol)).toEqual(['ETHUSDT']);
    expect(loadEuro).not.toHaveBeenCalled();
  });

  it('takes the EURUSDT route for a series with only some days USDT cannot price', async () => {
    const { asked, client } = clientOf({
      ETHUSDT: closes(3_000, 3_100),
      EURUSDT: closes(1.08, 1.1),
    });

    const entries = await fetchFallbackHistory({
      coins: ['ETH'],
      start: day(0),
      end: day(1),
      usdtPriceAt: (at) => (at === day(0) ? 40 : undefined),
      loadEuroPriceAt: euroLoader(() => 44),
      client,
    });

    expect(asked.map((call) => call.symbol)).toEqual(['ETHUSDT', 'EURUSDT']);
    expect(entries).toEqual([
      { base: 'ETH', quote: 'UAH', day: day(0), rate: 3_000 * 40, source: 'binance' },
      { base: 'ETH', quote: 'UAH', day: day(1), rate: 3_100 * (44 / 1.1), source: 'binance' },
    ]);
  });

  it('asks no EURUSDT and loads no EUR for a coin whose series is empty', async () => {
    const { asked, client } = clientOf({ ETHUSDT: [], EURUSDT: closes(1.08) });
    const loadEuro = euroLoader(() => 43);

    const entries = await fetchFallbackHistory({
      coins: ['ETH'],
      start: day(0),
      end: day(0),
      usdtPriceAt: NO_ANCHOR,
      loadEuroPriceAt: loadEuro,
      client,
    });

    expect(entries).toEqual([]);
    expect(asked.map((call) => call.symbol)).toEqual(['ETHUSDT']);
    expect(loadEuro).not.toHaveBeenCalled();
  });

  it('loads no EUR when EURUSDT has no answer', async () => {
    const { client } = clientOf({ ETHUSDT: closes(3_000), EURUSDT: undefined });
    const loadEuro = euroLoader(() => 43);

    await expect(
      fetchFallbackHistory({
        coins: ['ETH'],
        start: day(0),
        end: day(0),
        usdtPriceAt: NO_ANCHOR,
        loadEuroPriceAt: loadEuro,
        client,
      }),
    ).resolves.toEqual([]);
    expect(loadEuro).not.toHaveBeenCalled();
  });

  it('keeps the other coins and loads no EUR when USDT is held and EURUSDT has no answer', async () => {
    const { client } = clientOf({ ETHUSDT: closes(3_000), EURUSDT: undefined });
    const loadEuro = euroLoader(() => 43);

    await expect(
      fetchFallbackHistory({
        coins: ['ETH', 'USDT'],
        start: day(0),
        end: day(0),
        usdtPriceAt: () => 40,
        loadEuroPriceAt: loadEuro,
        client,
      }),
    ).resolves.toEqual([
      { base: 'ETH', quote: 'UAH', day: day(0), rate: 3_000 * 40, source: 'binance' },
    ]);
    expect(loadEuro).not.toHaveBeenCalled();
  });

  it('keeps the coins the market answered when another coin has no answer', async () => {
    const { client } = clientOf({ ETHUSDT: undefined, SOLUSDT: closes(150) });

    const entries = await fetchFallbackHistory({
      coins: ['ETH', 'SOL'],
      start: day(0),
      end: day(0),
      usdtPriceAt: () => 40,
      loadEuroPriceAt: euroLoader(NO_ANCHOR),
      client,
    });

    expect(entries.map((entry) => entry.base)).toEqual(['SOL']);
  });

  it('asks nothing for no coins', async () => {
    const { asked, client } = clientOf({ ETHUSDT: closes(3_000) });

    await fetchFallbackHistory({
      coins: [],
      start: day(0),
      end: day(0),
      usdtPriceAt: () => 40,
      loadEuroPriceAt: euroLoader(() => 43),
      client,
    });

    expect(asked).toEqual([]);
  });
});
