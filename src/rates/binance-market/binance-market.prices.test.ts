import { fetchFallbackPrices } from './binance-market.prices';
import type { BinanceMarketClient } from './binance-market.client';

const clientOf = (tickers: Record<string, number | undefined>) => {
  const asked: string[] = [];
  const client: BinanceMarketClient = {
    tickerPrice: async (symbol) => {
      asked.push(symbol);

      return tickers[symbol];
    },
    dailyCloses: async () => undefined,
  };

  return { asked, client };
};

describe('fetchFallbackPrices', () => {
  it("prices a coin CoinGecko missed through its USDT symbol and USDT's price", async () => {
    const { asked, client } = clientOf({ ETHUSDT: 3_000 });

    const prices = await fetchFallbackPrices({
      coins: ['ETH'],
      anchors: { usdt: 40.5, euro: 43 },
      client,
    });

    expect(prices).toEqual({ ETH: 121_500 });
    expect(asked).toEqual(['ETHUSDT']);
  });

  it('prices USDT through EURUSDT and the EUR anchor when USDT is unpriced', async () => {
    const { asked, client } = clientOf({ EURUSDT: 1.08 });

    const prices = await fetchFallbackPrices({
      coins: ['USDT'],
      anchors: { usdt: undefined, euro: 43 },
      client,
    });

    expect(prices).toEqual({ USDT: 43 / 1.08 });
    expect(asked).toEqual(['EURUSDT']);
  });

  it('prices a coin through the USDT price it derived from EURUSDT, asking EURUSDT once', async () => {
    const { asked, client } = clientOf({ EURUSDT: 1.1, BTCUSDT: 60_000, ETHUSDT: 3_000 });

    const prices = await fetchFallbackPrices({
      coins: ['BTC', 'ETH', 'USDT'],
      anchors: { usdt: undefined, euro: 44 },
      client,
    });

    expect(prices).toEqual({ BTC: 60_000 * (44 / 1.1), ETH: 3_000 * (44 / 1.1), USDT: 44 / 1.1 });
    expect(asked.filter((symbol) => symbol === 'EURUSDT')).toHaveLength(1);
  });

  it('never assumes 1:1 for a stablecoin: every one is its market price times USDT', async () => {
    const { client } = clientOf({ EURUSDT: 1.1, USDCUSDT: 0.9996, DAIUSDT: 1.0004 });

    const prices = await fetchFallbackPrices({
      coins: ['USDC', 'DAI', 'USDT'],
      anchors: { usdt: undefined, euro: 44 },
      client,
    });

    expect(prices.USDT).toBe(44 / 1.1);
    expect(prices.USDC).toBe(0.9996 * (44 / 1.1));
    expect(prices.DAI).toBe(1.0004 * (44 / 1.1));
    expect(prices.USDT).not.toBe(1);
    expect(prices.USDC).not.toBe(prices.USDT);
  });

  it('prices no stablecoin at all when USDT has no price from either source', async () => {
    const { asked, client } = clientOf({ EURUSDT: undefined, USDCUSDT: 0.9996 });

    const prices = await fetchFallbackPrices({
      coins: ['USDC', 'USDT'],
      anchors: { usdt: undefined, euro: 44 },
      client,
    });

    expect(prices).toEqual({});
    expect(asked).toEqual(['EURUSDT']);
  });

  it('asks nothing when USDT is unpriced and there is no EUR anchor', async () => {
    const { asked, client } = clientOf({ ETHUSDT: 3_000, EURUSDT: 1.1 });

    const prices = await fetchFallbackPrices({
      coins: ['ETH', 'USDT'],
      anchors: { usdt: undefined, euro: undefined },
      client,
    });

    expect(prices).toEqual({});
    expect(asked).toEqual([]);
  });

  it('asks nothing for no coins', async () => {
    const { asked, client } = clientOf({});

    await expect(
      fetchFallbackPrices({ coins: [], anchors: { usdt: 40, euro: 43 }, client }),
    ).resolves.toEqual({});
    expect(asked).toEqual([]);
  });

  it('leaves out a coin the market has no price for and keeps the others', async () => {
    const { client } = clientOf({ ETHUSDT: undefined, SOLUSDT: 150 });

    const prices = await fetchFallbackPrices({
      coins: ['ETH', 'SOL'],
      anchors: { usdt: 40, euro: 43 },
      client,
    });

    expect(prices).toEqual({ SOL: 6_000 });
  });

  it('asks no EURUSDT when USDT is priced', async () => {
    const { asked, client } = clientOf({ SOLUSDT: 150, EURUSDT: 1.1 });

    await fetchFallbackPrices({ coins: ['SOL'], anchors: { usdt: 40, euro: 43 }, client });

    expect(asked).toEqual(['SOLUSDT']);
  });

  it('asks every coin by its own USDT symbol from the registry', async () => {
    const { asked, client } = clientOf({});

    await fetchFallbackPrices({
      coins: ['FDUSD', 'CGPT', 'HYPE'],
      anchors: { usdt: 40, euro: 43 },
      client,
    });

    expect(asked).toEqual(['FDUSDUSDT', 'CGPTUSDT', 'HYPEUSDT']);
  });
});
