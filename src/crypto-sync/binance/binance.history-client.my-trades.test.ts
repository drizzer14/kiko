import {
  type BinanceMyTrade,
  BinanceHistoryParseError,
  fetchMyTrades,
  fetchOrderFills,
} from './binance.history-client';
import { BinanceInvalidSymbolError, BinanceRateLimitError } from './binance.client';

const NOW = 1_704_326_400_000;
const TRADED_AT = NOW - 1_000;

type SentRequest = { url: string; init: { method?: string; headers?: Record<string, string> } };

const wireTradeOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  symbol: 'BTCUSDT',
  id: 28_457,
  orderId: 100_234,
  orderListId: -1,
  price: '42000.10000000',
  qty: '0.01200000',
  quoteQty: '504.00120000',
  commission: '0.00001200',
  commissionAsset: 'BTC',
  time: TRADED_AT,
  isBuyer: true,
  isMaker: false,
  isBestMatch: true,
  ...overrides,
});

const tradeOf = (overrides: Partial<BinanceMyTrade> = {}): BinanceMyTrade => ({
  id: 28_457,
  orderId: 100_234,
  qty: '0.01200000',
  quoteQty: '504.00120000',
  commission: '0.00001200',
  commissionAsset: 'BTC',
  isBuyer: true,
  time: TRADED_AT,
  ...overrides,
});

const answerFetch = (
  body: unknown,
  { status = 200, headers = new Headers() }: { status?: number; headers?: Headers } = {},
): typeof fetch =>
  (async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
  })) as unknown as typeof fetch;

const spyFetch = (sent: SentRequest[], body: unknown = []): typeof fetch =>
  (async (url: string, init: SentRequest['init']) => {
    sent.push({ url, init });

    return { ok: true, status: 200, headers: new Headers(), json: async () => body };
  }) as unknown as typeof fetch;

const readTrades = (body: unknown, headers?: Headers, status?: number) =>
  fetchMyTrades('api-key-fixture', 'secret-fixture', 'BTCUSDT', 0, {
    fetchImpl: answerFetch(body, { headers, status }),
    now: () => NOW,
  });

const readFills = (body: unknown, headers?: Headers) =>
  fetchOrderFills('api-key-fixture', 'secret-fixture', 'BTCUSDT', 100_234, 0, {
    fetchImpl: answerFetch(body, { headers }),
    now: () => NOW,
  });

const paramsOf = (request: SentRequest): URLSearchParams => new URL(request.url).searchParams;

describe('fetchMyTrades', () => {
  it('asks a signed myTrades for the symbol from the id, at the page limit', async () => {
    const sent: SentRequest[] = [];

    await fetchMyTrades('api-key-fixture', 'secret-fixture', 'BTCUSDT', 0, {
      fetchImpl: spyFetch(sent),
      now: () => NOW,
    });

    const [request] = sent;
    const parsed = new URL(request.url);

    expect(sent).toHaveLength(1);
    expect(parsed.pathname).toBe('/api/v3/myTrades');
    expect(request.init.method).toBe('GET');
    expect(request.init.headers).toEqual({
      'X-MBX-APIKEY': 'api-key-fixture',
      'Cache-Control': 'no-store',
    });
    expect([...parsed.searchParams.keys()].sort()).toEqual([
      'fromId',
      'limit',
      'recvWindow',
      'signature',
      'symbol',
      'timestamp',
    ]);
    expect(parsed.searchParams.get('symbol')).toBe('BTCUSDT');
    expect(parsed.searchParams.get('fromId')).toBe('0');
    expect(parsed.searchParams.get('limit')).toBe('1000');
    expect(parsed.searchParams.get('timestamp')).toBe(String(NOW));
    expect(parsed.searchParams.get('signature')).toEqual(expect.any(String));
  });

  it('asks from the id it is given', async () => {
    const sent: SentRequest[] = [];

    await fetchMyTrades('api-key-fixture', 'secret-fixture', 'ETHBTC', 28_458, {
      fetchImpl: spyFetch(sent),
      now: () => NOW,
    });

    expect(paramsOf(sent[0]).get('fromId')).toBe('28458');
    expect(paramsOf(sent[0]).get('symbol')).toBe('ETHBTC');
  });

  it('reads the eight fields of each trade and the weights Binance reports', async () => {
    const page = await readTrades(
      [wireTradeOf(), wireTradeOf({ id: 28_458, isBuyer: false, commissionAsset: ' bnb ' })],
      new Headers({
        'X-MBX-USED-WEIGHT-1M': '40',
        'X-SAPI-USED-UID-WEIGHT-1M': '3000',
        'X-SAPI-USED-IP-WEIGHT-1M': '12',
      }),
    );

    expect(page).toEqual({
      rows: [tradeOf(), tradeOf({ id: 28_458, isBuyer: false, commissionAsset: 'BNB' })],
      usedApiWeight1m: 40,
      usedUidWeight1m: 3000,
      usedIpWeight1m: 12,
    });
  });

  it('leaves the weights undefined without the headers', async () => {
    const page = await readTrades([]);

    expect(page).toEqual({
      rows: [],
      usedApiWeight1m: undefined,
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
    });
  });

  it('never reads a price, a list id or a maker flag', async () => {
    const page = await readTrades([wireTradeOf({ email: 'someone@example.com' })]);

    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual([
      'commission',
      'commissionAsset',
      'id',
      'isBuyer',
      'orderId',
      'qty',
      'quoteQty',
      'time',
    ]);
  });

  it('leaves the id to the pager, as sent', async () => {
    const page = await readTrades([
      wireTradeOf({ id: '28457' }),
      wireTradeOf({ id: undefined }),
      wireTradeOf({ id: 2 ** 53 }),
    ]);

    expect(page.rows.map((row) => row.id)).toEqual(['28457', undefined, 2 ** 53]);
  });

  it('reads the empty answer as no trade', async () => {
    expect((await readTrades([])).rows).toEqual([]);
  });

  it.each([
    ['a body that is not an array', { trades: [] }],
    ['a null body', null],
    ['a text body', 'trades'],
    ['a row that is no object', [wireTradeOf(), 'trade']],
    ['a null row', [null]],
    ['a qty that is not text', [wireTradeOf({ qty: 0.012 })]],
    ['no qty', [wireTradeOf({ qty: undefined })]],
    ['a quoteQty that is not text', [wireTradeOf({ quoteQty: 504 })]],
    ['a null quoteQty', [wireTradeOf({ quoteQty: null })]],
    ['a commission that is not text', [wireTradeOf({ commission: 0 })]],
    ['no commission', [wireTradeOf({ commission: undefined })]],
    ['a commissionAsset that is not text', [wireTradeOf({ commissionAsset: 7 })]],
    ['no commissionAsset', [wireTradeOf({ commissionAsset: undefined })]],
    ['an isBuyer that is not a boolean', [wireTradeOf({ isBuyer: 1 })]],
    ['an isBuyer of text', [wireTradeOf({ isBuyer: 'true' })]],
    ['no isBuyer', [wireTradeOf({ isBuyer: undefined })]],
    ['a time that is text', [wireTradeOf({ time: '1704326399000' })]],
    ['a fractional time', [wireTradeOf({ time: 1.5 })]],
    ['a time past 2^53', [wireTradeOf({ time: 2 ** 53 })]],
    ['no time', [wireTradeOf({ time: undefined })]],
    ['an orderId that is text', [wireTradeOf({ orderId: '100234' })]],
    ['a fractional orderId', [wireTradeOf({ orderId: 1.5 })]],
    ['an orderId past 2^53', [wireTradeOf({ orderId: 2 ** 53 })]],
    ['no orderId', [wireTradeOf({ orderId: undefined })]],
    ...['qty', 'quoteQty', 'commission'].flatMap((field) =>
      [
        ['an empty', ''],
        ['a double-dot', '1.2.3'],
        ['an exponent', '1e-8'],
        ['a negative', '-1'],
        ['a padded', ' 1'],
      ].map(([name, value]): [string, unknown] => [
        `${name} ${field}`,
        [wireTradeOf({ [field]: value })],
      ]),
    ),
  ])('fails the whole page for %s', async (_name, body) => {
    await expect(readTrades(body)).rejects.toBeInstanceOf(BinanceHistoryParseError);
  });

  it.each(['qty', 'quoteQty', 'commission'] as const)(
    'reads a whole-number text for %s',
    async (field) => {
      const page = await readTrades([wireTradeOf({ [field]: '12' })]);

      expect(page.rows[0]?.[field]).toBe('12');
    },
  );

  it('fails the page for an unreadable row among readable ones, never skipping a fill', async () => {
    const error = await readTrades([
      wireTradeOf({ id: 1 }),
      wireTradeOf({ id: 2, qty: null }),
      wireTradeOf({ id: 3 }),
    ]).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BinanceHistoryParseError);
    expect(error).toMatchObject({ message: 'Binance history response malformed' });
  });

  it.each([
    [429, '30', 30_000],
    [418, '120', 120_000],
  ])(
    'throws the rate limit error for HTTP %s with its Retry-After',
    async (status, seconds, milliseconds) => {
      const error = await readTrades([], new Headers({ 'Retry-After': seconds }), status).catch(
        (thrown: unknown) => thrown,
      );

      expect(error).toBeInstanceOf(BinanceRateLimitError);
      expect(error).toMatchObject({ status, retryAfterMs: milliseconds });
    },
  );

  it('throws the invalid symbol error for code -1121', async () => {
    const error = await readTrades({ code: -1121 }, undefined, 400).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(BinanceInvalidSymbolError);
  });

  it('rejects as a request failure for HTTP 500', async () => {
    const error = await readTrades({}, undefined, 500).catch((thrown: unknown) => thrown);

    expect(error).not.toBeInstanceOf(BinanceRateLimitError);
    expect(error).not.toBeInstanceOf(BinanceInvalidSymbolError);
    expect(error).toMatchObject({ message: 'Binance request failed: 500' });
  });
});

describe('fetchOrderFills', () => {
  it('asks the first page by symbol and orderId, at the page limit, with no fromId', async () => {
    const sent: SentRequest[] = [];

    await fetchOrderFills('api-key-fixture', 'secret-fixture', 'BTCUSDT', 7, 0, {
      fetchImpl: spyFetch(sent),
      now: () => NOW,
    });

    const parsed = new URL(sent[0].url);

    expect(parsed.pathname).toBe('/api/v3/myTrades');
    expect(sent[0].init.method).toBe('GET');
    expect([...parsed.searchParams.keys()].sort()).toEqual([
      'limit',
      'orderId',
      'recvWindow',
      'signature',
      'symbol',
      'timestamp',
    ]);
    expect(parsed.searchParams.get('symbol')).toBe('BTCUSDT');
    expect(parsed.searchParams.get('orderId')).toBe('7');
    expect(parsed.searchParams.get('limit')).toBe('1000');
  });

  it('adds the fromId from the second page on', async () => {
    const sent: SentRequest[] = [];

    await fetchOrderFills('api-key-fixture', 'secret-fixture', 'BTCUSDT', 7, 1_201, {
      fetchImpl: spyFetch(sent),
      now: () => NOW,
    });

    expect(paramsOf(sent[0]).get('orderId')).toBe('7');
    expect(paramsOf(sent[0]).get('fromId')).toBe('1201');
    expect(paramsOf(sent[0]).get('limit')).toBe('1000');
  });

  it('reads the fills and the weights the same way as the trade list', async () => {
    const page = await readFills(
      [wireTradeOf({ commissionAsset: ' bnb ' })],
      new Headers({ 'X-MBX-USED-WEIGHT-1M': '25' }),
    );

    expect(page).toEqual({
      rows: [tradeOf({ commissionAsset: 'BNB' })],
      usedApiWeight1m: 25,
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
    });
  });

  it.each([
    ['a body that is not an array', {}],
    ['a qty that is not text', [wireTradeOf({ qty: 1 })]],
    ['an isBuyer that is not a boolean', [wireTradeOf({ isBuyer: null })]],
    ['an orderId past 2^53', [wireTradeOf({ orderId: 2 ** 53 })]],
  ])('fails the whole page for %s', async (_name, body) => {
    await expect(readFills(body)).rejects.toBeInstanceOf(BinanceHistoryParseError);
  });

  it('throws the rate limit error for HTTP 429', async () => {
    const error = await fetchOrderFills('api-key-fixture', 'secret-fixture', 'BTCUSDT', 7, 0, {
      fetchImpl: answerFetch({}, { status: 429, headers: new Headers({ 'Retry-After': '5' }) }),
      now: () => NOW,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BinanceRateLimitError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 5_000 });
  });

  it('throws the invalid symbol error for code -1121', async () => {
    const error = await fetchOrderFills('api-key-fixture', 'secret-fixture', 'NOPE', 7, 0, {
      fetchImpl: answerFetch({ code: -1121 }, { status: 400 }),
      now: () => NOW,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BinanceInvalidSymbolError);
  });
});
