import {
  BinanceHistoryParseError,
  type BinanceP2pOrder,
  fetchP2pOrders,
  P2P_PAGE_ROWS,
  type TotalPage,
} from './binance.history-client';
import { BinanceHistoryTooOldError, BinanceRateLimitError } from './binance.client';

const NOW = 1_704_326_400_000;
const CREATED_AT = NOW - 1_000;

const respondWith = (
  body: unknown,
  { status = 200, headers = new Headers() }: { status?: number; headers?: Headers } = {},
) =>
  (async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => JSON.parse(JSON.stringify(body)),
  })) as unknown as typeof fetch;

const orderOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  orderNumber: '22225541213133',
  advNo: '11361253456893',
  tradeType: 'BUY',
  asset: 'USDT',
  fiat: 'UAH',
  fiatSymbol: '₴',
  amount: '100.00000000',
  totalPrice: '4150.00',
  unitPrice: '41.50',
  orderStatus: 'COMPLETED',
  createTime: CREATED_AT,
  commission: '0.00000000',
  counterPartNickName: 'a-counterparty',
  payMethodName: 'a-payment-method',
  additionalKycVerify: 1,
  takerCommissionRate: '0.001',
  takerCommission: '0.10000000',
  takerAmount: '99.90000000',
  advertisementRole: 'TAKER',
  ...overrides,
});

const envelopeOf = (
  data: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  code: '000000',
  message: 'success',
  data,
  total: Array.isArray(data) ? data.length : 0,
  success: true,
  ...extra,
});

const readPage = (
  body: unknown,
  response: { status?: number; headers?: Headers } = {},
): Promise<TotalPage<BinanceP2pOrder>> =>
  fetchP2pOrders('api-key-fixture', 'secret-fixture', 'BUY', { start: NOW - 5_000, end: NOW }, 1, {
    fetchImpl: respondWith(body, response),
    now: () => NOW,
  });

const readOrders = (...orders: unknown[]): Promise<TotalPage<BinanceP2pOrder>> =>
  readPage(envelopeOf(orders));

const ORDER_TEXT_FIELDS = [
  'orderStatus',
  'tradeType',
  'advertisementRole',
  'asset',
  'fiat',
  'amount',
  'totalPrice',
  'takerCommission',
  'takerAmount',
] as const;

describe('fetchP2pOrders', () => {
  it.each([
    ['BUY', 1],
    ['SELL', 3],
  ] as const)(
    'asks one page of one side and one window at 100 rows (%s, page %i)',
    async (side, page) => {
      const fetchImpl = jest.fn(respondWith(envelopeOf([])));

      await fetchP2pOrders(
        'api-key-fixture',
        'secret-fixture',
        side,
        { start: 1_000, end: 2_000 },
        page,
        { fetchImpl, now: () => NOW },
      );

      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      const parsed = new URL(url);

      expect(P2P_PAGE_ROWS).toBe(100);
      expect(parsed.pathname).toBe('/sapi/v1/c2c/orderMatch/listUserOrderHistory');
      expect(init.method).toBe('GET');
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        tradeType: side,
        startTimestamp: '1000',
        endTimestamp: '2000',
        page: String(page),
        rows: '100',
        timestamp: String(NOW),
        recvWindow: expect.any(String),
        signature: expect.any(String),
      });
      expect(init.headers).toMatchObject({ 'X-MBX-APIKEY': 'api-key-fixture' });
    },
  );

  it('reads the order with every field it names', async () => {
    const page = await readOrders(orderOf());

    expect(page.rows).toEqual([
      {
        orderNumber: '22225541213133',
        tradeType: 'BUY',
        asset: 'USDT',
        fiat: 'UAH',
        amount: '100.00000000',
        totalPrice: '4150.00',
        orderStatus: 'COMPLETED',
        createTime: CREATED_AT,
        takerCommission: '0.10000000',
        takerAmount: '99.90000000',
        advertisementRole: 'TAKER',
      },
    ]);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([]);
    expect(page.gathered).toBe(1);
    expect(page.total).toBe(1);
  });

  it('reads no counterparty field into the record', async () => {
    const page = await readOrders(orderOf());

    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual([
      'advertisementRole',
      'amount',
      'asset',
      'createTime',
      'fiat',
      'orderNumber',
      'orderStatus',
      'takerAmount',
      'takerCommission',
      'totalPrice',
      'tradeType',
    ]);
    expect(JSON.stringify(page)).not.toMatch(/a-counterparty|a-payment-method|11361253456893/);
  });

  it.each(['amount', 'takerCommission', 'takerAmount'] as const)(
    'keeps an absent %s undefined, so an absent text differs from an empty one',
    async (field) => {
      const absent = await readOrders(orderOf({ [field]: undefined }));
      const nulled = await readOrders(orderOf({ [field]: null }));
      const empty = await readOrders(orderOf({ [field]: '' }));

      expect(absent.rows[0]?.[field]).toBeUndefined();
      expect(nulled.rows[0]?.[field]).toBeUndefined();
      expect(empty.rows[0]?.[field]).toBe('');
    },
  );

  it.each(ORDER_TEXT_FIELDS)(
    'reads an order without %s, so the walk decides what it means',
    async (field) => {
      const page = await readOrders(orderOf({ [field]: undefined }));

      expect(page.unreadable).toEqual([]);
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]?.[field]).toBeUndefined();
    },
  );

  it('keeps the texts as Binance sent them, and the asset as an upper-cased ticker', async () => {
    const page = await readOrders(
      orderOf({
        asset: ' usdt ',
        fiat: 'uah',
        orderStatus: 'Completed ',
        totalPrice: '4150.000',
      }),
    );

    expect(page.rows).toMatchObject([
      { asset: 'USDT', fiat: 'uah', orderStatus: 'Completed ', totalPrice: '4150.000' },
    ]);
  });

  it.each([
    ['an empty orderNumber', { orderNumber: '' }],
    ['a missing orderNumber', { orderNumber: undefined }],
    ['an orderNumber that is a number', { orderNumber: 22_225_541_213_133 }],
  ])('reads an order with %s as unreadable, keeping its time', async (_name, overrides) => {
    const page = await readOrders(orderOf(overrides));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: CREATED_AT }]);
    expect(page.gathered).toBe(1);
  });

  it.each([
    ['a missing createTime', { createTime: undefined }],
    ['a createTime of text', { createTime: '1704326399000' }],
    ['a fractional createTime', { createTime: 1.5 }],
    ['a createTime past 2^53', { createTime: 2 ** 53 }],
  ])('reads an order with %s as unreadable', async (_name, overrides) => {
    const page = await readOrders(orderOf(overrides));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toHaveLength(1);
    expect(page.gathered).toBe(1);
  });

  it('keeps the time of an unreadable order only when it is a usable number', async () => {
    const fractional = await readOrders(orderOf({ createTime: 1.5 }));
    const missing = await readOrders(orderOf({ createTime: undefined }));

    expect(fractional.unreadable).toEqual([{ time: 1.5 }]);
    expect(missing.unreadable).toEqual([{ time: undefined }]);
  });

  it('reads an order that is no object as unreadable with no time, beside the readable ones', async () => {
    const page = await readOrders(
      orderOf({ orderNumber: 'a' }),
      'not an order',
      orderOf({ orderNumber: 'c' }),
    );

    expect(page.rows.map((row) => row.orderNumber)).toEqual(['a', 'c']);
    expect(page.unreadable).toEqual([{ time: undefined }]);
    expect(page.gathered).toBe(3);
  });

  it.each([
    ['an empty list', envelopeOf([])],
    ['a null list', envelopeOf(null, { total: 0 })],
    ['no list', { code: '000000', message: 'success', total: 0, success: true }],
  ])('reads %s as a window with no order', async (_name, body) => {
    const page = await readPage(body);

    expect(page).toMatchObject({ rows: [], unreadable: [], untracked: [], gathered: 0, total: 0 });
  });

  it('carries the total Binance reports, apart from the orders of the page', async () => {
    const page = await readPage(envelopeOf([orderOf()], { total: 250 }));

    expect(page).toMatchObject({ gathered: 1, total: 250 });
  });

  it.each([
    ['a body that is no object', 'oops'],
    ['a null body', null],
    ['an array body', []],
    ['a code other than 000000', envelopeOf([], { code: '-1' })],
    ['a code that is a number', envelopeOf([], { code: 0 })],
    ['no code', { message: 'success', data: [], total: 0 }],
    ['a list that is no array', envelopeOf({}, { total: 0 })],
    ['a string list', envelopeOf('[]', { total: 0 })],
    ['no total', { code: '000000', data: [] }],
    ['a total of text', envelopeOf([], { total: '0' })],
    ['a null total', envelopeOf([], { total: null })],
    ...ORDER_TEXT_FIELDS.flatMap((field): [string, unknown][] => [
      [`a ${field} that is a number`, envelopeOf([orderOf({ [field]: 7 })])],
      [`a ${field} that is a flag`, envelopeOf([orderOf({ [field]: true })])],
      [`a ${field} that is an object`, envelopeOf([orderOf({ [field]: {} })])],
    ]),
  ])('fails the whole page for %s', async (_name, body) => {
    await expect(readPage(body)).rejects.toBeInstanceOf(BinanceHistoryParseError);
  });

  it('fails the whole page for a wrong field among readable orders, never skipping the order', async () => {
    const error = await readOrders(
      orderOf({ orderNumber: 'a' }),
      orderOf({ orderNumber: 'b', amount: 100 }),
      orderOf({ orderNumber: 'c' }),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BinanceHistoryParseError);
    expect(error).toMatchObject({ message: 'Binance history response malformed' });
  });

  it('carries the weights Binance reports in the headers', async () => {
    const page = await readPage(envelopeOf([]), {
      headers: new Headers({
        'X-SAPI-USED-UID-WEIGHT-1M': '900',
        'X-SAPI-USED-IP-WEIGHT-1M': '12',
      }),
    });

    expect(page).toMatchObject({ usedUidWeight1m: 900, usedIpWeight1m: 12 });
  });

  it('leaves the weights undefined without the headers', async () => {
    const page = await readPage(envelopeOf([]));

    expect(page).toMatchObject({ usedUidWeight1m: undefined, usedIpWeight1m: undefined });
  });

  describe('a refused request', () => {
    it.each([429, 418])(
      'maps HTTP %i to BinanceRateLimitError with its retryAfterMs',
      async (status) => {
        const attempt = readPage(
          { code: -1003 },
          { status, headers: new Headers({ 'Retry-After': '30' }) },
        );

        await expect(attempt).rejects.toBeInstanceOf(BinanceRateLimitError);
        await expect(attempt).rejects.toMatchObject({ status, retryAfterMs: 30_000 });
      },
    );

    it('maps code -5026 on an HTTP 400 to BinanceHistoryTooOldError', async () => {
      await expect(readPage({ code: -5026 }, { status: 400 })).rejects.toBeInstanceOf(
        BinanceHistoryTooOldError,
      );
    });

    it('maps HTTP 500 to the request-failed error, not to a parse error or a refusal', async () => {
      const attempt = readPage({ code: -1000 }, { status: 500 });

      await expect(attempt).rejects.toThrow('Binance request failed: 500');
      await expect(attempt).rejects.not.toBeInstanceOf(BinanceHistoryTooOldError);
      await expect(attempt).rejects.not.toBeInstanceOf(BinanceRateLimitError);
      await expect(attempt).rejects.not.toBeInstanceOf(BinanceHistoryParseError);
    });
  });
});
