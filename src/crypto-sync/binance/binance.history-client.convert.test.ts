import {
  type ConvertHistoryPage,
  BinanceHistoryParseError,
  CONVERT_PAGE_LIMIT,
  fetchConvertHistory,
} from './binance.history-client';

const NOW = 1_704_326_400_000;
const CREATED_AT = NOW - 1_000;

const textFetch = (text: string, headers: Headers = new Headers()) =>
  (async () => ({
    ok: true,
    status: 200,
    headers,
    json: async () => JSON.parse(text),
  })) as unknown as typeof fetch;

const bodyFetch = (body: unknown, headers: Headers = new Headers()) =>
  textFetch(JSON.stringify(body), headers);

const readPage = (body: unknown, headers?: Headers): Promise<ConvertHistoryPage> =>
  fetchConvertHistory(
    'api-key-fixture',
    'secret-fixture',
    { startTime: NOW - 5_000, endTime: NOW },
    { fetchImpl: bodyFetch(body, headers), now: () => NOW },
  );

const recordOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  quoteId: 'quote-1',
  orderId: 'order-1',
  orderStatus: 'SUCCESS',
  walletType: 'FUNDING',
  fromAsset: 'UAH',
  fromAmount: '1000',
  toAsset: 'USDT',
  toAmount: '24.1',
  ratio: '0.0241',
  inverseRatio: '41.49',
  createTime: CREATED_AT,
  ...overrides,
});

const readRecords = (...records: unknown[]): Promise<ConvertHistoryPage> =>
  readPage({ list: records, moreData: false });

const QUOTE_FIELD = '"quoteId":"f3b91c525b2644c7bc1e1cd31b6e1aa6"';

// Raw body text, because `JSON.stringify` cannot write an integer past 2^53 as Binance does.
const bodyTextOf = (...identifierFields: string[]): string =>
  `{"list":[{${identifierFields.join(',')},"orderStatus":"SUCCESS","walletType":"FUNDING",` +
  '"fromAsset":"UAH","fromAmount":"1000","toAsset":"USDT","toAmount":"24.1","ratio":"0.0241",' +
  `"inverseRatio":"41.49","createTime":${CREATED_AT}}],"moreData":false}`;

const readBodyText = (text: string): Promise<ConvertHistoryPage> =>
  fetchConvertHistory(
    'api-key-fixture',
    'secret-fixture',
    { startTime: NOW - 5_000, endTime: NOW },
    { fetchImpl: textFetch(text), now: () => NOW },
  );

describe('fetchConvertHistory', () => {
  it('reads a SUCCESS record with every field', async () => {
    const page = await readRecords(recordOf());

    expect(page.rows).toEqual([
      {
        recordId: 'quote-1',
        orderStatus: 'SUCCESS',
        walletType: 'FUNDING',
        fromAsset: 'UAH',
        fromAmount: '1000',
        toAsset: 'USDT',
        toAmount: '24.1',
        createTime: CREATED_AT,
      },
    ]);
    expect(page.unreadable).toEqual([]);
  });

  it('reads the assets upper-cased and trimmed', async () => {
    const page = await readRecords(recordOf({ fromAsset: ' uah ', toAsset: 'usdt' }));

    expect(page.rows).toMatchObject([{ fromAsset: 'UAH', toAsset: 'USDT' }]);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['of another JSON type', 1],
  ])('reads a %s walletType as undefined', async (_name, walletType) => {
    const page = await readRecords(recordOf({ walletType }));

    expect(page.rows).toMatchObject([{ walletType: undefined }]);
  });

  it.each([
    ['FAIL', 'FAIL'],
    ['PROCESS', 'PROCESS'],
    ['absent', undefined],
    ['empty', ''],
  ])('reads a record whose assets or amounts are absent, status %s', async (_name, orderStatus) => {
    const page = await readRecords(
      recordOf({
        orderStatus,
        fromAsset: undefined,
        fromAmount: null,
        toAsset: undefined,
        toAmount: undefined,
      }),
    );

    expect(page.unreadable).toEqual([]);
    expect(page.rows).toEqual([
      {
        recordId: 'quote-1',
        orderStatus,
        walletType: 'FUNDING',
        fromAsset: undefined,
        fromAmount: undefined,
        toAsset: undefined,
        toAmount: undefined,
        createTime: CREATED_AT,
      },
    ]);
  });

  it.each([
    ['a text orderId', { orderId: 'order-2' }],
    ['a safe-integer orderId', { orderId: 940_708_407_462_087 }],
    ['an empty orderId', { orderId: '' }],
    ['a missing orderId', { orderId: undefined }],
    ['a null orderId', { orderId: null }],
    ['an orderId of another JSON type', { orderId: true }],
  ])('keys a record by its quoteId for %s', async (_name, overrides) => {
    const page = await readRecords(recordOf({ ...overrides, quoteId: 'quote-2' }));

    expect(page.rows).toMatchObject([{ recordId: 'quote-2' }]);
  });

  it('keys a record by its quoteId when its orderId is an integer past 2^53 in the body text', async () => {
    const page = await readBodyText(bodyTextOf(QUOTE_FIELD, '"orderId":1940000000000000001'));

    expect(page.rows).toMatchObject([{ recordId: 'f3b91c525b2644c7bc1e1cd31b6e1aa6' }]);
    expect(page.unreadable).toEqual([]);
  });

  it.each([
    ['a text orderId', '"orderId":"order-2"'],
    ['a safe-integer orderId', '"orderId":940708407462087'],
    ['an orderId past 2^53', '"orderId":1940000000000000001'],
  ])('reads a record with %s and no quoteId as unreadable, keeping its time', async (_name, id) => {
    const page = await readBodyText(bodyTextOf(id));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: CREATED_AT }]);
  });

  it.each([
    ['no orderId and no quoteId', { orderId: undefined, quoteId: undefined }],
    ['an empty quoteId', { orderId: undefined, quoteId: '' }],
    ['a quoteId that is no text', { orderId: undefined, quoteId: 7 }],
    ['an orderId and an empty quoteId', { orderId: 'order-2', quoteId: '' }],
  ])('reads a record with %s as unreadable, keeping its time', async (_name, overrides) => {
    const page = await readRecords(recordOf(overrides));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: CREATED_AT }]);
  });

  it('reads a record with no createTime as unreadable with no time', async () => {
    const page = await readRecords(recordOf({ createTime: undefined }));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: undefined }]);
  });

  it('reads a record that is no object as unreadable with no time', async () => {
    const page = await readRecords('not a record', recordOf());

    expect(page.rows).toHaveLength(1);
    expect(page.unreadable).toEqual([{ time: undefined }]);
  });

  it('keeps the readable records of a page beside an unreadable one', async () => {
    const page = await readRecords(
      recordOf({ quoteId: 'a' }),
      recordOf({ orderId: undefined, quoteId: undefined, createTime: CREATED_AT - 1 }),
      recordOf({ quoteId: 'c' }),
    );

    expect(page.rows.map((row) => row.recordId)).toEqual(['a', 'c']);
    expect(page.unreadable).toEqual([{ time: CREATED_AT - 1 }]);
  });

  it('reads the fields it names only', async () => {
    const page = await readRecords(recordOf({ email: 'someone@example.com', ratio: '9' }));

    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual([
      'createTime',
      'fromAmount',
      'fromAsset',
      'orderStatus',
      'recordId',
      'toAmount',
      'toAsset',
      'walletType',
    ]);
  });

  it('reads an empty list', async () => {
    const page = await readPage({ list: [], moreData: false });

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
    expect(page.moreData).toBe(false);
  });

  it.each([[true], [false]])('reads moreData %s', async (moreData) => {
    const page = await readPage({ list: [], moreData });

    expect(page.moreData).toBe(moreData);
  });

  it.each([
    ['no moreData', { list: [] }],
    ['a moreData that is no flag', { list: [], moreData: 'false' }],
    ['no list', { moreData: false }],
    ['a list that is no array', { list: {}, moreData: false }],
    ['a null list', { list: null, moreData: false }],
    ['a body that is no object', 'oops'],
    ['a null body', null],
    ['an array body', []],
  ])('fails the page for a body with %s', async (_name, body) => {
    await expect(readPage(body)).rejects.toBeInstanceOf(BinanceHistoryParseError);
  });

  it('sends startTime, endTime and limit 1000 to the tradeFlow path', async () => {
    const fetchImpl = jest.fn(bodyFetch({ list: [], moreData: false }));

    await fetchConvertHistory(
      'api-key-fixture',
      'secret-fixture',
      { startTime: 1_000, endTime: 2_000 },
      { fetchImpl, now: () => NOW },
    );

    expect(CONVERT_PAGE_LIMIT).toBe(1000);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);

    expect(parsed.pathname).toBe('/sapi/v1/convert/tradeFlow');
    expect(init.method).toBe('GET');
    expect(parsed.searchParams.get('startTime')).toBe('1000');
    expect(parsed.searchParams.get('endTime')).toBe('2000');
    expect(parsed.searchParams.get('limit')).toBe('1000');
    expect(parsed.searchParams.get('signature')).toEqual(expect.any(String));
  });

  it('carries the weights Binance reports in the headers', async () => {
    const page = await readPage(
      { list: [], moreData: false },
      new Headers({
        'X-SAPI-USED-UID-WEIGHT-1M': '3000',
        'X-SAPI-USED-IP-WEIGHT-1M': '12',
      }),
    );

    expect(page).toMatchObject({ usedUidWeight1m: 3000, usedIpWeight1m: 12 });
  });

  it('leaves the weights undefined without the headers', async () => {
    const page = await readPage({ list: [], moreData: false });

    expect(page).toMatchObject({ usedUidWeight1m: undefined, usedIpWeight1m: undefined });
  });
});
