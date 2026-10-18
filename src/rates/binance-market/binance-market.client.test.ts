import { DAY_MS } from '@kiko/dates';
import { BINANCE_API_ENDPOINT } from '@env';
import { DEFAULT_RETRY_AFTER_MS } from '@kiko/crypto-sync/binance';

import { createBinanceMarketClient } from './binance-market.client';

const NOW = 1_800_000_000_000;

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

type Call = { url: string; init: RequestInit | undefined };

const makeFetch = (answer: (url: string) => Reply | Error) => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const reply = answer(url);

    if (reply instanceof Error) {
      throw reply;
    }
    const status = reply.status ?? 200;

    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(reply.headers),
      json: async () => reply.body,
    };
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
};

let keyCounter = 0;
// The cooldown store is module-level, so every case asks under its own key.
const freshKey = (): string => {
  keyCounter += 1;

  return `binance-market-test-${keyCounter}`;
};

const noSleep = async (): Promise<void> => undefined;

const clientOf = (
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createBinanceMarketClient>[0]> = {},
) =>
  createBinanceMarketClient({
    fetchImpl,
    now: () => NOW,
    sleep: noSleep,
    cooldownKey: freshKey(),
    ...overrides,
  });

const priceBody = (price: string) => ({ symbol: 'BTCUSDT', price });

describe('createBinanceMarketClient — tickerPrice', () => {
  it('reads the price of one symbol from ticker/price on the pinned host', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({ body: priceBody('65000.12000000') }));

    const price = await clientOf(fetchImpl).tickerPrice('BTCUSDT');

    expect(price).toBe(65_000.12);
    expect(calls.map((call) => call.url)).toEqual([
      `${BINANCE_API_ENDPOINT}/api/v3/ticker/price?symbol=BTCUSDT`,
    ]);
    expect(BINANCE_API_ENDPOINT).toBe('https://api.binance.com');
  });

  it('sends no key header and no signed query', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({ body: priceBody('1.5') }));
    const client = clientOf(fetchImpl);

    await client.tickerPrice('BTCUSDT');
    await client.dailyCloses('BTCUSDT', NOW - 2 * DAY_MS, NOW);

    expect(calls).toHaveLength(2);

    for (const call of calls) {
      expect(JSON.stringify(call.init ?? {}).toLowerCase()).not.toContain('apikey');
      expect(call.url).not.toContain('signature');
      expect(call.url).not.toContain('timestamp');
      expect(call.url).not.toContain('recvWindow');
    }
  });

  it.each([451, 403])(
    'reads HTTP %i as no price, never a throw, and asks no further symbol this run',
    async (status) => {
      const { calls, fetchImpl } = makeFetch(() => ({ status, body: { code: 0 } }));
      const client = clientOf(fetchImpl);

      await expect(client.tickerPrice('BTCUSDT')).resolves.toBeUndefined();
      await expect(client.tickerPrice('ETHUSDT')).resolves.toBeUndefined();

      expect(calls).toHaveLength(1);
    },
  );

  it.each([418, 429])(
    'reads HTTP %i as no price and makes exactly one request for the whole run',
    async (status) => {
      const { calls, fetchImpl } = makeFetch(() => ({
        status,
        headers: { 'Retry-After': '30' },
        body: { code: -1003 },
      }));
      const client = clientOf(fetchImpl);

      await expect(client.tickerPrice('BTCUSDT')).resolves.toBeUndefined();
      await expect(client.tickerPrice('BTCUSDT')).resolves.toBeUndefined();
      await expect(client.tickerPrice('ETHUSDT')).resolves.toBeUndefined();

      expect(calls).toHaveLength(1);
    },
  );

  it.each([418, 429])(
    'keeps the Retry-After of an HTTP %i, so a later run asks nothing until it passes',
    async (status) => {
      const key = freshKey();
      const refused = makeFetch(() => ({ status, headers: { 'Retry-After': '30' } }));
      await clientOf(refused.fetchImpl, { cooldownKey: key }).tickerPrice('BTCUSDT');

      const duringCooldown = makeFetch(() => ({ body: priceBody('1') }));
      const during = clientOf(duringCooldown.fetchImpl, {
        cooldownKey: key,
        now: () => NOW + 29_999,
      });
      await expect(during.tickerPrice('BTCUSDT')).resolves.toBeUndefined();
      await expect(during.dailyCloses('BTCUSDT', NOW, NOW)).resolves.toBeUndefined();

      expect(duringCooldown.calls).toHaveLength(0);

      const afterCooldown = makeFetch(() => ({ body: priceBody('1') }));
      const after = clientOf(afterCooldown.fetchImpl, {
        cooldownKey: key,
        now: () => NOW + 30_000,
      });
      await expect(after.tickerPrice('BTCUSDT')).resolves.toBe(1);

      expect(afterCooldown.calls).toHaveLength(1);
    },
  );

  it('waits the default time when a rate-limit answer carries no Retry-After', async () => {
    const key = freshKey();
    const refused = makeFetch(() => ({ status: 429 }));
    await clientOf(refused.fetchImpl, { cooldownKey: key }).tickerPrice('BTCUSDT');

    const early = makeFetch(() => ({ body: priceBody('1') }));
    await clientOf(early.fetchImpl, {
      cooldownKey: key,
      now: () => NOW + DEFAULT_RETRY_AFTER_MS - 1,
    }).tickerPrice('BTCUSDT');
    const late = makeFetch(() => ({ body: priceBody('1') }));
    await clientOf(late.fetchImpl, {
      cooldownKey: key,
      now: () => NOW + DEFAULT_RETRY_AFTER_MS,
    }).tickerPrice('BTCUSDT');

    expect(early.calls).toHaveLength(0);
    expect(late.calls).toHaveLength(1);
  });

  it('reads an unlisted symbol (HTTP 400) as no price and still asks the next symbol', async () => {
    const { calls, fetchImpl } = makeFetch((url) =>
      url.includes('NOPEUSDT') ? { status: 400, body: { code: -1121 } } : { body: priceBody('2') },
    );
    const client = clientOf(fetchImpl);

    await expect(client.tickerPrice('NOPEUSDT')).resolves.toBeUndefined();
    await expect(client.tickerPrice('BTCUSDT')).resolves.toBe(2);

    expect(calls).toHaveLength(2);
  });

  it('reads a network error as no price', async () => {
    const { fetchImpl } = makeFetch(() => new Error('offline'));

    await expect(clientOf(fetchImpl).tickerPrice('BTCUSDT')).resolves.toBeUndefined();
  });

  it.each([
    ['an empty object', {}],
    ['a list', []],
    ['null', null],
    ['a price that is not a number', { price: 'abc' }],
    ['a price that is not text', { price: 5 }],
    ['a zero price', { price: '0.00000000' }],
    ['a negative price', { price: '-1' }],
    ['an infinite price', { price: 'Infinity' }],
  ])('reads %s as no price', async (_label, body) => {
    const { fetchImpl } = makeFetch(() => ({ body }));

    await expect(clientOf(fetchImpl).tickerPrice('BTCUSDT')).resolves.toBeUndefined();
  });

  it('reads a body that is not JSON as no price', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    })) as unknown as typeof fetch;

    await expect(clientOf(fetchImpl).tickerPrice('BTCUSDT')).resolves.toBeUndefined();
  });
});

describe('createBinanceMarketClient — the shared /api/* IP budget', () => {
  it('asks nothing once the reported weight of the minute leaves no room for a call', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({
      body: priceBody('3'),
      headers: { 'X-MBX-USED-WEIGHT-1M': '2999' },
    }));
    const client = clientOf(fetchImpl);

    await expect(client.tickerPrice('BTCUSDT')).resolves.toBe(3);
    await expect(client.tickerPrice('ETHUSDT')).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
  });

  it('keeps asking while the reported weight leaves room', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({
      body: priceBody('3'),
      headers: { 'X-MBX-USED-WEIGHT-1M': '2998' },
    }));
    const client = clientOf(fetchImpl);

    await client.tickerPrice('BTCUSDT');
    await client.tickerPrice('ETHUSDT');

    expect(calls).toHaveLength(2);
  });

  it('paces the requests of one run at the Binance interval', async () => {
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    const { fetchImpl } = makeFetch(() => ({ body: priceBody('3') }));
    const client = clientOf(fetchImpl, { sleep });

    await client.tickerPrice('BTCUSDT');
    await client.tickerPrice('ETHUSDT');

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(350);
  });

  it('stops asking after the lane cap of calls in one run', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({ body: priceBody('3') }));
    const client = clientOf(fetchImpl);

    for (let call = 0; call < 160; call += 1) {
      await client.tickerPrice('BTCUSDT');
    }

    expect(calls).toHaveLength(150);
  });
});

const kline = (openTime: number, close: string) => [
  openTime,
  '1.0',
  '2.0',
  '0.5',
  close,
  '10.0',
  openTime + DAY_MS - 1,
  '10.0',
  1,
  '5.0',
  '5.0',
  '0',
];

describe('createBinanceMarketClient — dailyCloses', () => {
  const DAY_ONE = 1_799_798_400_000;

  it('reads the daily candles of one symbol for the days asked, on the pinned host', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({
      body: [kline(DAY_ONE, '100.5'), kline(DAY_ONE + DAY_MS, '101.25')],
    }));

    const closes = await clientOf(fetchImpl).dailyCloses('BTCUSDT', DAY_ONE, DAY_ONE + DAY_MS);

    expect(closes).toEqual([
      { day: DAY_ONE, close: 100.5 },
      { day: DAY_ONE + DAY_MS, close: 101.25 },
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      `${BINANCE_API_ENDPOINT}/api/v3/klines?symbol=BTCUSDT&interval=1d` +
        `&startTime=${DAY_ONE}&endTime=${DAY_ONE + 2 * DAY_MS - 1}&limit=2`,
    ]);
  });

  it('asks for at most 1000 days, the newest ones', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({ body: [] }));
    const lastDay = DAY_ONE + 2000 * DAY_MS;

    await clientOf(fetchImpl).dailyCloses('BTCUSDT', DAY_ONE, lastDay);

    expect(calls[0].url).toContain(`startTime=${lastDay - 999 * DAY_MS}`);
    expect(calls[0].url).toContain('limit=1000');
  });

  it('reads an empty answer as an empty series, not as a failure', async () => {
    const { fetchImpl } = makeFetch(() => ({ body: [] }));

    await expect(clientOf(fetchImpl).dailyCloses('BTCUSDT', DAY_ONE, DAY_ONE)).resolves.toEqual([]);
  });

  it('leaves out a candle whose close is not a positive number', async () => {
    const { fetchImpl } = makeFetch(() => ({
      body: [kline(DAY_ONE, 'abc'), kline(DAY_ONE + DAY_MS, '0'), kline(DAY_ONE + 2 * DAY_MS, '7')],
    }));

    await expect(
      clientOf(fetchImpl).dailyCloses('BTCUSDT', DAY_ONE, DAY_ONE + 2 * DAY_MS),
    ).resolves.toEqual([{ day: DAY_ONE + 2 * DAY_MS, close: 7 }]);
  });

  it.each([
    ['an object', {}],
    ['null', null],
    ['text', 'nope'],
  ])('reads %s as a failure', async (_label, body) => {
    const { fetchImpl } = makeFetch(() => ({ body }));

    await expect(
      clientOf(fetchImpl).dailyCloses('BTCUSDT', DAY_ONE, DAY_ONE),
    ).resolves.toBeUndefined();
  });

  it.each([451, 403, 400, 418, 429])('reads HTTP %i as a failure', async (status) => {
    const { fetchImpl } = makeFetch(() => ({ status, body: { code: -1121 } }));

    await expect(
      clientOf(fetchImpl).dailyCloses('BTCUSDT', DAY_ONE, DAY_ONE),
    ).resolves.toBeUndefined();
  });

  it('reads a network error as a failure', async () => {
    const { fetchImpl } = makeFetch(() => new Error('offline'));

    await expect(
      clientOf(fetchImpl).dailyCloses('BTCUSDT', DAY_ONE, DAY_ONE),
    ).resolves.toBeUndefined();
  });
});
