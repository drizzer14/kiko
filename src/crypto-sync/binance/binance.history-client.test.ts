import {
  BINANCE_HISTORY_PARSE_ERROR,
  BinanceHistoryParseError,
  fetchDepositHistory,
  fetchEarnRecords,
  fetchPayHistory,
  fetchUniversalTransfers,
  fetchWithdrawHistory,
  HISTORY_PAGE_LIMIT,
  HISTORY_TOTAL_PAGE_SIZE,
  PAY_PAGE_LIMIT,
  UNIVERSAL_TRANSFER_TYPES,
} from './binance.history-client';
import { signQuery } from './binance.hmac';
import { BinanceRateLimitError, type FetchAccountOptions } from './binance.client';

const NOW = 1_704_326_400_000;
const API_KEY = 'api-key-fixture';
const SECRET = 'secret-fixture';
const START = 1_700_000_000_000;

type SentRequest = { url: URL; method: string | undefined; headers: Record<string, string> };

type FakeResponse = { status?: number; headers?: Headers };

const recordingFetch = (
  body: unknown,
  { status = 200, headers = new Headers() }: FakeResponse = {},
) => {
  const sent: SentRequest[] = [];
  const fetchImpl = (async (
    url: string,
    init: { method?: string; headers: Record<string, string> },
  ) => {
    sent.push({ url: new URL(url), method: init.method, headers: init.headers });

    return { ok: status >= 200 && status < 300, status, headers, json: async () => body };
  }) as unknown as typeof fetch;

  return { fetchImpl, sent };
};

const optionsFor = (fetchImpl: typeof fetch): FetchAccountOptions => ({
  fetchImpl,
  now: () => NOW,
});

const paramsOf = (url: URL): Record<string, string> => Object.fromEntries(url.searchParams);

const without = (row: Record<string, unknown>, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

const PARSE_FAILURE = expect.objectContaining({ message: BINANCE_HISTORY_PARSE_ERROR });

const SIGNED = { timestamp: String(NOW), recvWindow: '5000', signature: expect.any(String) };

const payRead = (body: unknown, response?: FakeResponse) => {
  const { fetchImpl, sent } = recordingFetch(body, response);

  return {
    sent,
    run: () =>
      fetchPayHistory(API_KEY, SECRET, { startTime: START, endTime: NOW }, optionsFor(fetchImpl)),
  };
};

const transferRead = (body: unknown, response?: FakeResponse) => {
  const { fetchImpl, sent } = recordingFetch(body, response);

  return {
    sent,
    run: () =>
      fetchUniversalTransfers(
        API_KEY,
        SECRET,
        { type: 'MAIN_FUNDING', startTime: START, endTime: NOW, current: 1 },
        optionsFor(fetchImpl),
      ),
  };
};

const EARN_KINDS = [
  ['flexibleSubscription', '/sapi/v1/simple-earn/flexible/history/subscriptionRecord'],
  ['flexibleRedemption', '/sapi/v1/simple-earn/flexible/history/redemptionRecord'],
  ['flexibleRewards', '/sapi/v1/simple-earn/flexible/history/rewardsRecord'],
  ['lockedSubscription', '/sapi/v1/simple-earn/locked/history/subscriptionRecord'],
  ['lockedRedemption', '/sapi/v1/simple-earn/locked/history/redemptionRecord'],
  ['lockedRewards', '/sapi/v1/simple-earn/locked/history/rewardsRecord'],
] as const;

describe('request shape', () => {
  it('GETs the Pay history with the window and limit 100, no asset', async () => {
    const read = payRead({ code: '000000', data: [] });

    await read.run();

    expect(read.sent[0].url.pathname).toBe('/sapi/v1/pay/transactions');
    expect(read.sent[0].method).toBe('GET');
    expect(PAY_PAGE_LIMIT).toBe(100);
    expect(paramsOf(read.sent[0].url)).toEqual({
      startTime: String(START),
      endTime: String(NOW),
      limit: '100',
      ...SIGNED,
    });
  });

  it('GETs one universal-transfer type with current and size 100, and no asset', async () => {
    const { fetchImpl, sent } = recordingFetch({ total: 0 });

    await fetchUniversalTransfers(
      API_KEY,
      SECRET,
      { type: 'UMFUTURE_MAIN', startTime: START, endTime: NOW, current: 3 },
      optionsFor(fetchImpl),
    );

    expect(sent[0].url.pathname).toBe('/sapi/v1/asset/transfer');
    expect(sent[0].method).toBe('GET');
    expect(HISTORY_TOTAL_PAGE_SIZE).toBe(100);
    expect(paramsOf(sent[0].url)).toEqual({
      type: 'UMFUTURE_MAIN',
      startTime: String(START),
      endTime: String(NOW),
      current: '3',
      size: '100',
      ...SIGNED,
    });
  });

  it.each(EARN_KINDS.filter(([kind]) => kind !== 'flexibleRewards'))(
    'GETs %s with asset BTC, current and size 100, and no type',
    async (kind, path) => {
      const { fetchImpl, sent } = recordingFetch({ total: 0 });

      await fetchEarnRecords(
        API_KEY,
        SECRET,
        kind,
        { startTime: START, endTime: NOW, current: 2 },
        optionsFor(fetchImpl),
      );

      expect(sent[0].url.pathname).toBe(path);
      expect(sent[0].method).toBe('GET');
      expect(paramsOf(sent[0].url)).toEqual({
        asset: 'BTC',
        startTime: String(START),
        endTime: String(NOW),
        current: '2',
        size: '100',
        ...SIGNED,
      });
    },
  );

  it('always sends type=ALL on the flexible rewards read', async () => {
    const { fetchImpl, sent } = recordingFetch({ total: 0 });

    await fetchEarnRecords(
      API_KEY,
      SECRET,
      'flexibleRewards',
      { startTime: START, endTime: NOW, current: 1 },
      optionsFor(fetchImpl),
    );

    expect(sent[0].url.pathname).toBe('/sapi/v1/simple-earn/flexible/history/rewardsRecord');
    expect(paramsOf(sent[0].url)).toEqual({
      asset: 'BTC',
      type: 'ALL',
      startTime: String(START),
      endTime: String(NOW),
      current: '1',
      size: '100',
      ...SIGNED,
    });
  });

  it('keeps the capital reads on coin BTC with offset and limit 1000', async () => {
    const deposits = recordingFetch([]);
    const withdrawals = recordingFetch([]);
    const window = { startTime: START, endTime: NOW, offset: 2000 };

    await fetchDepositHistory(API_KEY, SECRET, window, optionsFor(deposits.fetchImpl));
    await fetchWithdrawHistory(API_KEY, SECRET, window, optionsFor(withdrawals.fetchImpl));

    const expectedParams = {
      coin: 'BTC',
      startTime: String(START),
      endTime: String(NOW),
      offset: '2000',
      limit: '1000',
      ...SIGNED,
    };
    expect(HISTORY_PAGE_LIMIT).toBe(1000);
    expect(deposits.sent[0].url.pathname).toBe('/sapi/v1/capital/deposit/hisrec');
    expect(deposits.sent[0].method).toBe('GET');
    expect(paramsOf(deposits.sent[0].url)).toEqual(expectedParams);
    expect(withdrawals.sent[0].url.pathname).toBe('/sapi/v1/capital/withdraw/history');
    expect(withdrawals.sent[0].method).toBe('GET');
    expect(paramsOf(withdrawals.sent[0].url)).toEqual(expectedParams);
  });

  it('reads the 20 universal-transfer types, Spot-Funding first', () => {
    expect(UNIVERSAL_TRANSFER_TYPES).toEqual([
      'MAIN_FUNDING',
      'FUNDING_MAIN',
      'MAIN_UMFUTURE',
      'UMFUTURE_MAIN',
      'MAIN_CMFUTURE',
      'CMFUTURE_MAIN',
      'MAIN_MARGIN',
      'MARGIN_MAIN',
      'MAIN_OPTION',
      'OPTION_MAIN',
      'MAIN_PORTFOLIO_MARGIN',
      'PORTFOLIO_MARGIN_MAIN',
      'FUNDING_UMFUTURE',
      'UMFUTURE_FUNDING',
      'FUNDING_CMFUTURE',
      'CMFUTURE_FUNDING',
      'FUNDING_MARGIN',
      'MARGIN_FUNDING',
      'FUNDING_OPTION',
      'OPTION_FUNDING',
    ]);
  });
});

describe('signing', () => {
  it('ends the query with the HMAC of everything before it, and sends the key and no-store', async () => {
    const read = payRead({ code: '000000', data: [] });

    await read.run();

    const { url, headers } = read.sent[0];
    const [signedPart, signature] = url.search.slice(1).split('&signature=');
    expect(url.search.endsWith(`&signature=${signature}`)).toBe(true);
    expect(signature).toBe(signQuery(SECRET, signedPart));
    expect(headers['X-MBX-APIKEY']).toBe(API_KEY);
    expect(headers['Cache-Control']).toBe('no-store');
  });
});

describe('used-weight headers', () => {
  it('reports both the UID and the IP weight of the minute', async () => {
    const read = transferRead(
      { total: 0 },
      {
        headers: new Headers({
          'X-SAPI-USED-UID-WEIGHT-1M': '36000',
          'X-SAPI-USED-IP-WEIGHT-1M': '420',
        }),
      },
    );

    const page = await read.run();

    expect(page.usedUidWeight1m).toBe(36_000);
    expect(page.usedIpWeight1m).toBe(420);
  });

  it('reports undefined for a missing header', async () => {
    const page = await transferRead({ total: 0 }).run();

    expect(page.usedUidWeight1m).toBeUndefined();
    expect(page.usedIpWeight1m).toBeUndefined();
  });

  it('reports undefined for a non-numeric header', async () => {
    const page = await payRead(
      { code: '000000', data: [] },
      {
        headers: new Headers({
          'X-SAPI-USED-UID-WEIGHT-1M': 'abc',
          'X-SAPI-USED-IP-WEIGHT-1M': 'NaN',
        }),
      },
    ).run();

    expect(page.usedUidWeight1m).toBeUndefined();
    expect(page.usedIpWeight1m).toBeUndefined();
  });

  it('reports the weights of a capital page too', async () => {
    const { fetchImpl } = recordingFetch([], {
      headers: new Headers({ 'X-SAPI-USED-UID-WEIGHT-1M': '18000' }),
    });

    const page = await fetchWithdrawHistory(
      API_KEY,
      SECRET,
      { startTime: START, endTime: NOW, offset: 0 },
      optionsFor(fetchImpl),
    );

    expect(page).toEqual({ rows: [], usedUidWeight1m: 18_000, usedIpWeight1m: undefined });
  });
});

describe('rate limits and failures', () => {
  it.each([429, 418])('throws BinanceRateLimitError with retryAfterMs on a %s', async (status) => {
    const read = payRead({}, { status, headers: new Headers({ 'Retry-After': '30' }) });

    await expect(read.run()).rejects.toBeInstanceOf(BinanceRateLimitError);
    await expect(read.run()).rejects.toMatchObject({ status, retryAfterMs: 30_000 });
  });

  it('surfaces a non-rate-limit non-ok response as the request-failed error', async () => {
    await expect(transferRead({}, { status: 401 }).run()).rejects.toThrow(
      'Binance request failed: 401',
    );
  });
});

const payOrderBody = {
  orderType: 'C2C',
  transactionId: '10002',
  transactionTime: 1_700_000_001_000,
  amount: '-0.001',
  currency: 'BTC',
  walletType: 2,
  walletTypes: [1, 2],
  fundsDetail: [
    { currency: 'BTC', amount: '0.001', walletAssetCost: { '1': '0.0006', '2': '0.0004' } },
  ],
  payerInfo: { name: 'Me', binanceId: '111' },
  receiverInfo: { name: 'Ann', binanceId: '222' },
};

const parsedPayOrder = {
  ...payOrderBody,
  fundsDetail: [
    {
      currency: 'BTC',
      amount: '0.001',
      walletAssetCost: [
        { walletType: 1, amount: '0.0006' },
        { walletType: 2, amount: '0.0004' },
      ],
    },
  ],
};

const payPageOf = (order: Record<string, unknown>) =>
  payRead({ code: '000000', data: [order] }).run();

describe('fetchPayHistory envelope', () => {
  it('parses an empty success envelope', async () => {
    const page = await payRead({ code: '000000', data: [] }).run();

    expect(page.rows).toEqual([]);
  });

  it('parses an order field by field', async () => {
    const page = await payPageOf(payOrderBody);

    expect(page.rows).toEqual([parsedPayOrder]);
  });

  it.each([
    ['a code other than 000000', { code: '-1', data: [] }],
    ['a missing code', { data: [] }],
    ['missing data', { code: '000000' }],
    ['data that is not an array', { code: '000000', data: { rows: [] } }],
    ['a null body', null],
    ['a string body', 'SECRET-BODY-TEXT'],
    ['an array body', [{ code: '000000', data: [] }]],
  ])('throws the fixed error for %s, with no URL or body in the message', async (_label, body) => {
    await expect(payRead(body).run()).rejects.toThrow(PARSE_FAILURE);
  });

  it('throws a named BinanceHistoryParseError, so a log can tell it from any other error', async () => {
    const error = await payRead(null)
      .run()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BinanceHistoryParseError);
    expect(error).toMatchObject({
      name: 'BinanceHistoryParseError',
      message: BINANCE_HISTORY_PARSE_ERROR,
    });
  });

  it('throws the fixed error for an order that is not an object', async () => {
    await expect(payRead({ code: '000000', data: ['x'] }).run()).rejects.toThrow(PARSE_FAILURE);
  });

  it.each(['orderType', 'amount', 'currency', 'transactionTime'])(
    'throws the fixed error when %s is missing',
    async (field) => {
      await expect(payPageOf(without(payOrderBody, field))).rejects.toThrow(PARSE_FAILURE);
    },
  );

  it('keeps an empty transactionId so the walk can stop on it', async () => {
    const page = await payPageOf({ ...payOrderBody, transactionId: '' });

    expect(page.rows[0].transactionId).toBe('');
  });

  it('reads an absent walletType, walletTypes and fundsDetail as undefined, undefined and empty', async () => {
    const page = await payPageOf(without(payOrderBody, 'walletType', 'walletTypes', 'fundsDetail'));

    expect(page.rows[0]).toMatchObject({
      walletType: undefined,
      walletTypes: undefined,
      fundsDetail: [],
    });
  });

  it.each([
    ['a string walletType', { walletType: '1' }],
    ['a fractional walletType', { walletType: 1.5 }],
    ['walletTypes that is not an array', { walletTypes: 1 }],
    ['a non-integer walletTypes entry', { walletTypes: [1, 'x'] }],
    ['fundsDetail that is not an array', { fundsDetail: {} }],
    ['a fundsDetail entry that is not an object', { fundsDetail: ['x'] }],
    ['a fundsDetail entry without an amount', { fundsDetail: [{ currency: 'BTC' }] }],
    ['payerInfo that is not an object', { payerInfo: 'Me' }],
  ])('throws the fixed error for %s', async (_label, overrides) => {
    await expect(payPageOf({ ...payOrderBody, ...overrides })).rejects.toThrow(PARSE_FAILURE);
  });
});

// The Pay history lists every coin's orders. Only BTC orders reach a row, so only they
// may fail the read: a malformed order of another coin must not stall the BTC walk.
describe('fetchPayHistory other coins', () => {
  const usdtOrder = {
    ...payOrderBody,
    transactionId: '10003',
    currency: 'USDT',
    fundsDetail: [{ currency: 'USDT', amount: '1' }],
  };

  const pageOfOrders = (...orders: unknown[]) => payRead({ code: '000000', data: orders }).run();

  it('returns the BTC orders only, and counts every order of the page', async () => {
    const page = await pageOfOrders(payOrderBody, usdtOrder, { ...usdtOrder, transactionId: '1' });

    expect(page.rows).toEqual([parsedPayOrder]);
    expect(page.gathered).toBe(3);
  });

  it.each([
    ['an amount that is missing', without(usdtOrder, 'amount')],
    ['a transactionTime that is a string', { ...usdtOrder, transactionTime: 'soon' }],
    ['an orderType that is missing', without(usdtOrder, 'orderType')],
    ['fundsDetail that is not an array', { ...usdtOrder, fundsDetail: 'x' }],
    ['a payerInfo that is not an object', { ...usdtOrder, payerInfo: 'Me' }],
    ['a walletType that is a string', { ...usdtOrder, walletType: 'x' }],
  ])('does not fail the read for a non-BTC order with %s', async (_label, offContract) => {
    const page = await pageOfOrders(payOrderBody, offContract);

    expect(page.rows).toEqual([parsedPayOrder]);
    expect(page.gathered).toBe(2);
  });

  it.each([
    ['an amount that is missing', without(payOrderBody, 'amount')],
    ['fundsDetail that is not an array', { ...payOrderBody, fundsDetail: 'x' }],
  ])('still fails the read for a BTC order with %s', async (_label, offContract) => {
    await expect(pageOfOrders(usdtOrder, offContract)).rejects.toThrow(PARSE_FAILURE);
  });

  it.each([
    ['a missing currency', without(usdtOrder, 'currency')],
    ['a currency that is not a string', { ...usdtOrder, currency: 7 }],
    ['an order that is not an object', null],
  ])('fails the read for %s, since the coin cannot be told', async (_label, order) => {
    await expect(pageOfOrders(order)).rejects.toThrow(PARSE_FAILURE);
  });

  it('flags a non-BTC order that was paid with BTC funds', async () => {
    const paidWithBtc = {
      ...usdtOrder,
      fundsDetail: [{ currency: 'BTC', amount: '1' }],
    };

    expect((await pageOfOrders(paidWithBtc)).hasBtcFundedOtherCoinOrder).toBe(true);
    expect((await pageOfOrders(usdtOrder)).hasBtcFundedOtherCoinOrder).toBe(false);
    expect((await pageOfOrders(usdtOrder, payOrderBody)).hasBtcFundedOtherCoinOrder).toBe(false);
  });

  it('reads a malformed fundsDetail of a non-BTC order as no BTC funds, never an error', async () => {
    const page = await pageOfOrders({ ...usdtOrder, fundsDetail: 'BTC' });

    expect(page.hasBtcFundedOtherCoinOrder).toBe(false);
  });
});

describe('fetchPayHistory walletAssetCost', () => {
  const orderWithCost = (walletAssetCost: unknown) => ({
    ...payOrderBody,
    fundsDetail: [{ currency: 'BTC', amount: '0.001', walletAssetCost }],
  });

  it('parses the wallet-keyed map into walletType and amount entries', async () => {
    const page = await payPageOf(orderWithCost({ '1': '0.6', '2': '0.6' }));

    expect(page.rows[0].fundsDetail[0].walletAssetCost).toEqual([
      { walletType: 1, amount: '0.6' },
      { walletType: 2, amount: '0.6' },
    ]);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['an empty map', {}],
  ])('parses %s as no entries', async (_label, walletAssetCost) => {
    const page = await payPageOf(orderWithCost(walletAssetCost));

    expect(page.rows[0].fundsDetail[0].walletAssetCost).toEqual([]);
  });

  it.each([['x'], ['-1'], ['1.5'], ['1e2'], ['']])(
    'throws the fixed error for the key %p',
    async (key) => {
      await expect(payPageOf(orderWithCost({ [key]: '0.6' }))).rejects.toThrow(PARSE_FAILURE);
    },
  );

  it.each([[0.6], [null], [{ amount: '0.6' }]])(
    'throws the fixed error for the value %p',
    async (value) => {
      await expect(payPageOf(orderWithCost({ '1': value }))).rejects.toThrow(PARSE_FAILURE);
    },
  );

  it.each([
    ['an array', [['1', '0.6']]],
    ['a string', '1:0.6'],
    ['a number', 1],
  ])('throws the fixed error when the cost is %s', async (_label, walletAssetCost) => {
    await expect(payPageOf(orderWithCost(walletAssetCost))).rejects.toThrow(PARSE_FAILURE);
  });
});

describe('fetchPayHistory counterparties', () => {
  const partyWithPersonalData = {
    name: 'Ann',
    binanceId: '222',
    email: 'ann@example.com',
    phone: '+380000000000',
    accountId: 'acc-9',
    countryCode: 'UA',
    cardNumber: '4111111111111111',
    institutionName: 'Some Bank',
    digitalWalletId: 'wallet-1',
  };

  it('keeps only name and binanceId on the receiver and the payer', async () => {
    const page = await payPageOf({
      ...payOrderBody,
      payerInfo: { ...partyWithPersonalData, name: 'Me', binanceId: '111' },
      receiverInfo: partyWithPersonalData,
    });

    const { payerInfo, receiverInfo } = page.rows[0];
    expect(Object.keys(receiverInfo).sort()).toEqual(['binanceId', 'name']);
    expect(Object.keys(payerInfo).sort()).toEqual(['binanceId', 'name']);
    expect(receiverInfo).toEqual({ name: 'Ann', binanceId: '222' });
    expect(JSON.stringify(page.rows)).not.toMatch(/example\.com|4111|Some Bank|wallet-1|acc-9/);
  });

  it('keeps only the listed order fields', async () => {
    const page = await payPageOf({ ...payOrderBody, userMemo: 'private note', extra: { a: 1 } });

    expect(Object.keys(page.rows[0]).sort()).toEqual(Object.keys(parsedPayOrder).sort());
  });

  it('parses a numeric binanceId to a string', async () => {
    const page = await payPageOf({
      ...payOrderBody,
      receiverInfo: { name: 'Ann', binanceId: 222 },
    });

    expect(page.rows[0].receiverInfo.binanceId).toBe('222');
  });

  it.each([[''], [1.5], [Number.NaN], [true], [null], [{}], [Number.MAX_SAFE_INTEGER + 2]])(
    'reads the binanceId %p as undefined',
    async (binanceId) => {
      const page = await payPageOf({ ...payOrderBody, receiverInfo: { name: 'Ann', binanceId } });

      expect(page.rows[0].receiverInfo).toEqual({ name: 'Ann', binanceId: undefined });
    },
  );

  it('reads an absent or null party, and a non-string name, as undefined fields', async () => {
    const noParty = { name: undefined, binanceId: undefined };

    const absent = await payPageOf({
      ...without(payOrderBody, 'payerInfo'),
      receiverInfo: { name: 7 },
    });
    const nullParty = await payPageOf({ ...payOrderBody, payerInfo: null });

    expect(absent.rows[0].payerInfo).toEqual(noParty);
    expect(absent.rows[0].receiverInfo).toEqual(noParty);
    expect(nullParty.rows[0].payerInfo).toEqual(noParty);
  });
});

describe('fetchUniversalTransfers', () => {
  const transferRow = {
    asset: 'BTC',
    amount: '0.01',
    type: 'MAIN_FUNDING',
    status: 'CONFIRMED',
    tranId: '11415',
    timestamp: 1_700_000_002_000,
  };

  it('returns an empty page with total 0 when rows is absent', async () => {
    const page = await transferRead({ total: 0 }).run();

    expect(page).toMatchObject({ rows: [], total: 0 });
  });

  it('parses the rows and the total, and drops unlisted fields', async () => {
    const page = await transferRead({ total: 31, rows: [{ ...transferRow, note: 'x' }] }).run();

    expect(page.rows).toEqual([transferRow]);
    expect(page.total).toBe(31);
  });

  it('parses a numeric tranId to a string', async () => {
    const page = await transferRead({ total: 1, rows: [{ ...transferRow, tranId: 11415 }] }).run();

    expect(page.rows[0].tranId).toBe('11415');
  });

  it.each([
    ['a non-numeric total', { total: '5', rows: [] }],
    ['a null total', { total: null, rows: [] }],
    ['a missing total', { rows: [] }],
    ['a non-finite total', { total: Number.POSITIVE_INFINITY, rows: [] }],
    ['rows that is not an array', { total: 1, rows: {} }],
    ['a row that is not an object', { total: 1, rows: ['x'] }],
    ['a row without a status', { total: 1, rows: [without(transferRow, 'status')] }],
    ['a row with an empty tranId', { total: 1, rows: [{ ...transferRow, tranId: '' }] }],
    ['a row with a text timestamp', { total: 1, rows: [{ ...transferRow, timestamp: 'now' }] }],
    ['a null body', null],
    ['an array body', []],
  ])('throws the fixed error for %s', async (_label, body) => {
    await expect(transferRead(body).run()).rejects.toThrow(PARSE_FAILURE);
  });
});

describe('fetchEarnRecords', () => {
  const earnPage = <Kind extends (typeof EARN_KINDS)[number][0]>(kind: Kind, body: unknown) => {
    const { fetchImpl } = recordingFetch(body);

    return fetchEarnRecords(
      API_KEY,
      SECRET,
      kind,
      { startTime: START, endTime: NOW, current: 1 },
      optionsFor(fetchImpl),
    );
  };

  it('returns an empty page with total 0 when rows is absent', async () => {
    const page = await earnPage('lockedRewards', { total: 0 });

    expect(page).toMatchObject({ rows: [], total: 0 });
  });

  it('throws the fixed error for a non-numeric total', async () => {
    await expect(earnPage('flexibleRewards', { total: 'x' })).rejects.toThrow(PARSE_FAILURE);
  });

  it('parses a flexible subscription', async () => {
    const page = await earnPage('flexibleSubscription', {
      total: 1,
      rows: [
        {
          amount: '0.5',
          asset: 'BTC',
          time: 1_700_000_003_000,
          purchaseId: 40607,
          productId: 'BTC001',
          type: 'FAST',
          sourceAccount: 'ALL',
          amtFromSpot: '0.3',
          amtFromFunding: '0.2',
          status: 'SUCCESS',
          unlisted: 'x',
        },
      ],
    });

    expect(page.rows).toEqual([
      {
        amount: '0.5',
        asset: 'BTC',
        time: 1_700_000_003_000,
        purchaseId: '40607',
        productId: 'BTC001',
        type: 'FAST',
        sourceAccount: 'ALL',
        amtFromSpot: '0.3',
        amtFromFunding: '0.2',
        status: 'SUCCESS',
      },
    ]);
  });

  it('parses a flexible subscription without its optional fields', async () => {
    const page = await earnPage('flexibleSubscription', {
      total: 1,
      rows: [{ amount: '0.5', asset: 'BTC', time: 1, purchaseId: 'p1', status: 'SUCCESS' }],
    });

    expect(page.rows[0]).toEqual({
      amount: '0.5',
      asset: 'BTC',
      time: 1,
      purchaseId: 'p1',
      status: 'SUCCESS',
      productId: undefined,
      type: undefined,
      sourceAccount: undefined,
      amtFromSpot: undefined,
      amtFromFunding: undefined,
    });
    expect(Object.keys(page.rows[0])).toHaveLength(10);
  });

  it('parses a flexible redemption', async () => {
    const page = await earnPage('flexibleRedemption', {
      total: 1,
      rows: [
        {
          amount: '0.4',
          asset: 'BTC',
          time: 1_700_000_004_000,
          projectId: 'BTC001',
          redeemId: 7_001,
          destAccount: 'SPOT',
          status: 'SUCCESS',
        },
      ],
    });

    expect(page.rows).toEqual([
      {
        amount: '0.4',
        asset: 'BTC',
        time: 1_700_000_004_000,
        projectId: 'BTC001',
        redeemId: '7001',
        destAccount: 'SPOT',
        status: 'SUCCESS',
      },
    ]);
  });

  it('parses a flexible reward, which has no id of its own', async () => {
    const reward = {
      asset: 'BTC',
      rewards: '0.00000002',
      projectId: 'BTC001',
      type: 'REALTIME',
      time: 1_700_000_005_000,
    };

    const page = await earnPage('flexibleRewards', { total: 1, rows: [reward] });

    expect(page.rows).toEqual([reward]);
  });

  it('parses a locked subscription', async () => {
    const page = await earnPage('lockedSubscription', {
      total: 1,
      rows: [
        {
          positionId: '123',
          purchaseId: 55,
          time: 1_700_000_006_000,
          asset: 'BTC',
          amount: '0.2',
          lockPeriod: '30',
          type: 'AUTO',
          sourceAccount: 'SPOT',
          amtFromSpot: '0.2',
          amtFromFunding: '0',
          status: 'SUCCESS',
        },
      ],
    });

    expect(page.rows).toEqual([
      {
        positionId: '123',
        purchaseId: '55',
        time: 1_700_000_006_000,
        asset: 'BTC',
        amount: '0.2',
        type: 'AUTO',
        sourceAccount: 'SPOT',
        amtFromSpot: '0.2',
        amtFromFunding: '0',
        status: 'SUCCESS',
      },
    ]);
  });

  it('parses a locked redemption', async () => {
    const page = await earnPage('lockedRedemption', {
      total: 1,
      rows: [
        {
          positionId: '123',
          redeemId: 8_002,
          time: 1_700_000_007_000,
          asset: 'BTC',
          amount: '0.2',
          originalAmount: '0.2',
          type: 'NORMAL',
          rewardAmt: '0.001',
          status: 'SUCCESS',
        },
      ],
    });

    expect(page.rows).toEqual([
      {
        positionId: '123',
        redeemId: '8002',
        time: 1_700_000_007_000,
        asset: 'BTC',
        amount: '0.2',
        originalAmount: '0.2',
        type: 'NORMAL',
        status: 'SUCCESS',
      },
    ]);
  });

  it('parses a locked reward', async () => {
    const page = await earnPage('lockedRewards', {
      total: 1,
      rows: [
        {
          positionId: 123,
          time: 1_700_000_008_000,
          asset: 'BTC',
          amount: '0.00001',
          lockPeriod: '30',
          type: 'Locked Rewards',
        },
      ],
    });

    expect(page.rows).toEqual([
      {
        positionId: '123',
        time: 1_700_000_008_000,
        asset: 'BTC',
        amount: '0.00001',
        type: 'Locked Rewards',
      },
    ]);
  });

  it.each([
    ['flexibleSubscription', { amount: '1', asset: 'BTC', time: 1, status: 'SUCCESS' }],
    ['flexibleRedemption', { amount: '1', asset: 'BTC', time: 1, status: 'SUCCESS' }],
    ['flexibleRewards', { asset: 'BTC', rewards: '1', projectId: 'p', type: 'REALTIME' }],
    ['lockedSubscription', { amount: '1', asset: 'BTC', time: 1, status: 'SUCCESS' }],
    ['lockedRedemption', { amount: '1', asset: 'BTC', time: 1, status: 'SUCCESS' }],
    ['lockedRewards', { time: 1, asset: 'BTC', amount: '1', type: 'Locked Rewards' }],
  ] as const)('throws the fixed error for a %s row missing its id or time', async (kind, row) => {
    await expect(earnPage(kind, { total: 1, rows: [row] })).rejects.toThrow(PARSE_FAILURE);
  });

  it.each([
    ['a null time', { time: null }],
    ['a text time', { time: 'now' }],
    ['a non-finite time', { time: Number.POSITIVE_INFINITY }],
    ['a numeric amount', { amount: 1 }],
    ['a missing type', { type: undefined }],
  ])('throws the fixed error for a locked reward with %s', async (_label, overrides) => {
    const row = { positionId: 'p', time: 1, asset: 'BTC', amount: '1', type: 't', ...overrides };

    await expect(earnPage('lockedRewards', { total: 1, rows: [row] })).rejects.toThrow(
      PARSE_FAILURE,
    );
  });
});

describe('capital reads', () => {
  const WINDOW = { startTime: START, endTime: NOW, offset: 0 };
  const depositRow = {
    id: '1',
    amount: '0.5',
    coin: 'BTC',
    txId: 'abc',
    insertTime: NOW,
    status: 1,
    walletType: 1,
  };
  const withdrawalRow = {
    id: '9',
    amount: '0.25',
    transactionFee: '0.0001',
    coin: 'BTC',
    txId: 'def',
    applyTime: '2023-11-15 08:30:00',
    status: 6,
    walletType: 0,
  };

  const readDeposits = (body: unknown) =>
    fetchDepositHistory(API_KEY, SECRET, WINDOW, optionsFor(recordingFetch(body).fetchImpl));

  const readWithdrawals = (body: unknown) =>
    fetchWithdrawHistory(API_KEY, SECRET, WINDOW, optionsFor(recordingFetch(body).fetchImpl));

  it('returns the deposits with their walletType, and drops unlisted fields', async () => {
    const page = await readDeposits([{ ...depositRow, address: 'bc1-secret' }]);

    expect(page.rows).toEqual([depositRow]);
  });

  it('returns the withdrawals with their walletType, and drops unlisted fields', async () => {
    const page = await readWithdrawals([{ ...withdrawalRow, address: 'bc1-secret' }]);

    expect(page.rows).toEqual([withdrawalRow]);
  });

  it('reads an absent walletType as undefined', async () => {
    const deposits = await readDeposits([without(depositRow, 'walletType')]);
    const withdrawals = await readWithdrawals([without(withdrawalRow, 'walletType')]);

    expect(deposits.rows[0].walletType).toBeUndefined();
    expect(withdrawals.rows[0].walletType).toBeUndefined();
  });

  it('keeps a numeric applyTime as it is', async () => {
    const page = await readWithdrawals([{ ...withdrawalRow, applyTime: NOW }]);

    expect(page.rows[0].applyTime).toBe(NOW);
  });

  it('reads a missing hash, fee and coin as empty text', async () => {
    const deposits = await readDeposits([without(depositRow, 'txId', 'coin')]);
    const withdrawals = await readWithdrawals([without(withdrawalRow, 'txId', 'transactionFee')]);

    expect(deposits.rows[0]).toMatchObject({ txId: '', coin: '' });
    expect(withdrawals.rows[0]).toMatchObject({ txId: '', transactionFee: '' });
  });

  it('reads an unusable id as empty text', async () => {
    const page = await readDeposits([{ ...depositRow, id: null }]);

    expect(page.rows[0].id).toBe('');
  });

  it.each([
    ['a body that is not an array', { rows: [] }],
    ['a row that is not an object', ['x']],
    ['a row without an amount', [without(depositRow, 'amount')]],
    ['a row without a status', [without(depositRow, 'status')]],
    ['a row without an insertTime', [without(depositRow, 'insertTime')]],
    ['a row with a fractional walletType', [{ ...depositRow, walletType: 0.5 }]],
  ])('throws the fixed error for deposits with %s', async (_label, body) => {
    await expect(readDeposits(body)).rejects.toThrow(PARSE_FAILURE);
  });

  it.each([
    ['a body that is not an array', null],
    ['a row without an applyTime', [without(withdrawalRow, 'applyTime')]],
    ['a row with a null applyTime', [{ ...withdrawalRow, applyTime: null }]],
    ['a row with a non-finite applyTime', [{ ...withdrawalRow, applyTime: Infinity }]],
    ['a row with a text status', [{ ...withdrawalRow, status: 'done' }]],
  ])('throws the fixed error for withdrawals with %s', async (_label, body) => {
    await expect(readWithdrawals(body)).rejects.toThrow(PARSE_FAILURE);
  });
});
