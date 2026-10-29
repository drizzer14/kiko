import type { WalkWindow } from '@kiko/crypto-sync/exchange/walk';

import {
  BinanceHistoryTooOldError,
  BinanceRateLimitError,
  type FetchAccountOptions,
} from './binance.client';
import {
  type BinanceFiatOrder,
  type BinanceFiatPayment,
  BinanceHistoryParseError,
  fetchFiatOrders,
  fetchFiatPayments,
  FIAT_ORDER_PAGE_ROWS,
  FIAT_PAYMENT_PAGE_ROWS,
  type FiatTransactionType,
  type TotalPage,
} from './binance.history-client';

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

type FiatFetch = (
  apiKey: string,
  secret: string,
  transactionType: FiatTransactionType,
  span: WalkWindow,
  page: number,
  options?: FetchAccountOptions,
) => Promise<TotalPage<BinanceFiatOrder | BinanceFiatPayment>>;

type FiatKind = {
  name: string;
  path: string;
  pageRows: number;
  fetchPage: FiatFetch;
  recordOf: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  readKeys: string[];
  textFields: string[];
  sentCounterpartTexts: RegExp;
};

const orderRecordOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  orderNo: '3b9f01e7a2c14d58',
  fiatCurrency: 'EUR',
  indicatedAmount: '100.00',
  amount: '98.50',
  totalFee: '1.50',
  method: 'a-bank-method',
  status: 'Successful',
  createTime: CREATED_AT,
  updateTime: CREATED_AT + 500,
  ...overrides,
});

const paymentRecordOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  orderNo: '9d41c0b6e83f4a27',
  sourceAmount: '2600.00',
  fiatCurrency: 'UAH',
  obtainAmount: '0.00100000',
  cryptoCurrency: 'BTC',
  totalFee: '12.00',
  price: '2600000.00',
  status: 'Completed',
  paymentMethod: 'a-card-method',
  createTime: CREATED_AT,
  updateTime: CREATED_AT + 500,
  ...overrides,
});

const KINDS: FiatKind[] = [
  {
    name: 'fiat orders',
    path: '/sapi/v1/fiat/orders',
    pageRows: 500,
    fetchPage: fetchFiatOrders,
    recordOf: orderRecordOf,
    readKeys: [
      'amount',
      'createTime',
      'fiatCurrency',
      'indicatedAmount',
      'orderNo',
      'status',
      'totalFee',
    ],
    textFields: ['fiatCurrency', 'indicatedAmount', 'amount', 'totalFee', 'status'],
    sentCounterpartTexts: /a-bank-method/,
  },
  {
    name: 'fiat payments',
    path: '/sapi/v1/fiat/payments',
    pageRows: 100,
    fetchPage: fetchFiatPayments,
    recordOf: paymentRecordOf,
    readKeys: [
      'createTime',
      'cryptoCurrency',
      'fiatCurrency',
      'obtainAmount',
      'orderNo',
      'sourceAmount',
      'status',
    ],
    textFields: ['sourceAmount', 'fiatCurrency', 'obtainAmount', 'cryptoCurrency', 'status'],
    sentCounterpartTexts: /a-card-method|2600000\.00/,
  },
];

describe.each(KINDS)('fetching $name', (kind) => {
  const readPage = (
    body: unknown,
    response: { status?: number; headers?: Headers } = {},
  ): Promise<TotalPage<BinanceFiatOrder | BinanceFiatPayment>> =>
    kind.fetchPage('api-key-fixture', 'secret-fixture', '0', { start: NOW - 5_000, end: NOW }, 1, {
      fetchImpl: respondWith(body, response),
      now: () => NOW,
    });

  const readRecords = (...records: unknown[]) => readPage(envelopeOf(records));

  it.each([
    ['0', 1],
    ['1', 3],
  ] as const)(
    `asks one page of ${kind.name} of type %s at ${kind.pageRows} rows (page %i)`,
    async (transactionType, page) => {
      const fetchImpl = jest.fn(respondWith(envelopeOf([])));

      await kind.fetchPage(
        'api-key-fixture',
        'secret-fixture',
        transactionType,
        { start: 1_000, end: 2_000 },
        page,
        { fetchImpl, now: () => NOW },
      );

      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      const parsed = new URL(url);

      expect(parsed.pathname).toBe(kind.path);
      expect(init.method).toBe('GET');
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        transactionType,
        beginTime: '1000',
        endTime: '2000',
        page: String(page),
        rows: String(kind.pageRows),
        timestamp: String(NOW),
        recvWindow: expect.any(String),
        signature: expect.any(String),
      });
      expect(init.headers).toMatchObject({ 'X-MBX-APIKEY': 'api-key-fixture' });
    },
  );

  it('reads the record with every field it names and no other', async () => {
    const page = await readRecords(kind.recordOf());

    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual(kind.readKeys);
    expect(JSON.stringify(page)).not.toMatch(kind.sentCounterpartTexts);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([]);
    expect(page.gathered).toBe(1);
    expect(page.total).toBe(1);
  });

  it.each(kind.textFields)(
    'reads a record without %s, so the walk decides what it means',
    async (field) => {
      const absent = await readRecords(kind.recordOf({ [field]: undefined }));
      const nulled = await readRecords(kind.recordOf({ [field]: null }));
      const empty = await readRecords(kind.recordOf({ [field]: '' }));

      expect(absent.unreadable).toEqual([]);
      expect(absent.rows).toHaveLength(1);
      expect((absent.rows[0] as Record<string, unknown>)[field]).toBeUndefined();
      expect((nulled.rows[0] as Record<string, unknown>)[field]).toBeUndefined();
      expect((empty.rows[0] as Record<string, unknown>)[field]).toBe('');
    },
  );

  it.each([
    'Successful',
    'Completed',
    'Refund Failed',
    'Order Partial Credit Stopped',
    ' Successful',
    'Successful ',
    'successful',
    'completed',
  ])('keeps the status text as Binance sent it, spaces and case included (%j)', async (status) => {
    const page = await readRecords(kind.recordOf({ status }));

    expect(page.rows[0]?.status).toBe(status);
  });

  it.each([
    ['an empty orderNo', { orderNo: '' }],
    ['a missing orderNo', { orderNo: undefined }],
    ['an orderNo that is a number', { orderNo: 3_901_728_345 }],
  ])('reads a record with %s as unreadable, keeping its time', async (_name, overrides) => {
    const page = await readRecords(kind.recordOf(overrides));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: CREATED_AT }]);
    expect(page.gathered).toBe(1);
  });

  it.each([
    ['a missing createTime', { createTime: undefined }],
    ['a createTime of text', { createTime: '1704326399000' }],
    ['a fractional createTime', { createTime: 1.5 }],
    ['a createTime past 2^53', { createTime: 2 ** 53 }],
  ])('reads a record with %s as unreadable', async (_name, overrides) => {
    const page = await readRecords(kind.recordOf(overrides));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toHaveLength(1);
    expect(page.gathered).toBe(1);
  });

  it('reads a record that is no object as unreadable with no time, beside the readable ones', async () => {
    const page = await readRecords(
      kind.recordOf({ orderNo: 'a' }),
      'not a record',
      kind.recordOf({ orderNo: 'c' }),
    );

    expect(page.rows.map((row) => row.orderNo)).toEqual(['a', 'c']);
    expect(page.unreadable).toEqual([{ time: undefined }]);
    expect(page.gathered).toBe(3);
  });

  it.each([
    ['an empty list', envelopeOf([])],
    ['a null list', envelopeOf(null, { total: 0 })],
    ['no list', { code: '000000', message: 'success', total: 0, success: true }],
  ])('reads %s as a window with no record', async (_name, body) => {
    const page = await readPage(body);

    expect(page).toMatchObject({ rows: [], unreadable: [], untracked: [], gathered: 0, total: 0 });
  });

  it('carries the total Binance reports, apart from the records of the page', async () => {
    const page = await readPage(envelopeOf([kind.recordOf()], { total: 250 }));

    expect(page).toMatchObject({ gathered: 1, total: 250 });
  });

  it.each([
    ['a body that is no object', 'oops'],
    ['a null body', null],
    ['an array body', []],
    ['a code other than 000000', envelopeOf([], { code: '-1' })],
    ['a code that is a number', envelopeOf([], { code: 0 })],
    ['no code', { message: 'success', data: [], total: 0 }],
    ['a null list with a total above zero', envelopeOf(null, { total: 3 })],
    ['no list with a total above zero', { code: '000000', total: 3, success: true }],
    ['a null list and no total', { code: '000000', data: null }],
    ['no list and no total', { code: '000000' }],
    ['a list that is no array', envelopeOf({}, { total: 0 })],
    ['a string list', envelopeOf('[]', { total: 0 })],
    ['no total', { code: '000000', data: [] }],
    ['a total of text', envelopeOf([], { total: '0' })],
    ['a null total', envelopeOf([], { total: null })],
    ...kind.textFields.flatMap((field): [string, unknown][] => [
      [`a ${field} that is a number`, envelopeOf([kind.recordOf({ [field]: 7 })])],
      [`a ${field} that is a flag`, envelopeOf([kind.recordOf({ [field]: true })])],
      [`a ${field} that is an object`, envelopeOf([kind.recordOf({ [field]: {} })])],
    ]),
  ])('fails the whole page for %s', async (_name, body) => {
    await expect(readPage(body)).rejects.toBeInstanceOf(BinanceHistoryParseError);
  });

  it('fails the whole page for a wrong field among readable records, never skipping the record', async () => {
    const error = await readRecords(
      kind.recordOf({ orderNo: 'a' }),
      kind.recordOf({ orderNo: 'b', status: 100 }),
      kind.recordOf({ orderNo: 'c' }),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BinanceHistoryParseError);
    expect(error).toMatchObject({ message: 'Binance history response malformed' });
  });

  it('carries the weights Binance reports in the headers', async () => {
    const page = await readPage(envelopeOf([]), {
      headers: new Headers({
        'X-SAPI-USED-UID-WEIGHT-1M': '45000',
        'X-SAPI-USED-IP-WEIGHT-1M': '1',
      }),
    });

    expect(page).toMatchObject({ usedUidWeight1m: 45_000, usedIpWeight1m: 1 });
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

describe('the fiat page sizes', () => {
  it('asks 500 fiat orders and 100 fiat payments a page', () => {
    expect(FIAT_ORDER_PAGE_ROWS).toBe(500);
    expect(FIAT_PAYMENT_PAGE_ROWS).toBe(100);
  });
});
