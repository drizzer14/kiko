import { fetchPayHistory, type PayHistoryPage } from './binance.history-client';

const NOW = 1_704_326_400_000;
const PAID_AT = NOW - 1_000;

const bodyFetch = (body: unknown) =>
  (async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  })) as unknown as typeof fetch;

const readOrders = (...orders: unknown[]): Promise<PayHistoryPage> =>
  fetchPayHistory(
    'api-key-fixture',
    'secret-fixture',
    { startTime: NOW - 5_000, endTime: NOW },
    { fetchImpl: bodyFetch({ code: '000000', data: orders }), now: () => NOW },
  );

const orderOf = (currency: unknown, funds: unknown): Record<string, unknown> => ({
  orderType: 'C2C',
  transactionId: 'tx-1',
  transactionTime: PAID_AT,
  amount: '-12.5',
  currency,
  walletType: 1,
  walletTypes: [1],
  fundsDetail: funds,
  payerInfo: { name: 'Me', binanceId: '111' },
  receiverInfo: { name: 'Ann', binanceId: '222' },
});

const fundsIn = (currency: unknown, amount: unknown = '12.5') => [{ currency, amount }];

describe('the coins of a Pay order', () => {
  it('reads an order in a tracked coin strictly, with its currency as Binance sends it', async () => {
    const page = await readOrders(orderOf('USDT', fundsIn('USDT')));

    expect(page.rows).toMatchObject([
      { currency: 'USDT', fundsDetail: [{ currency: 'USDT', amount: '12.5' }] },
    ]);
    expect(page.untracked).toEqual([]);
  });

  it('reads a lowercase currency, and a lowercase funds currency, upper-cased', async () => {
    const page = await readOrders(orderOf(' usdt ', fundsIn('btc')));

    expect(page.rows).toMatchObject([
      { currency: 'USDT', fundsDetail: [{ currency: 'BTC', amount: '12.5' }] },
    ]);
  });

  it.each([['EUR'], ['UAH']])('reads an order in the fiat code %s strictly', async (code) => {
    const page = await readOrders(orderOf(code, fundsIn(code)));

    expect(page.rows).toHaveLength(1);
    expect(page.untracked).toEqual([]);
  });

  it('reads an order in an untracked coin strictly when it was paid in a tracked coin', async () => {
    const page = await readOrders(orderOf('XYZ', fundsIn('USDT')));

    expect(page.rows).toMatchObject([{ currency: 'XYZ', fundsDetail: [{ currency: 'USDT' }] }]);
    expect(page.untracked).toEqual([]);
  });

  it('owes the point of an XYZ order paid in USDT whose funds amount is missing', async () => {
    const page = await readOrders(orderOf('XYZ', [{ currency: 'USDT' }]));

    expect(page.rows).toEqual([]);
    expect(page.untracked).toEqual([]);
    expect(page.unreadable).toEqual([{ time: PAID_AT }]);
  });

  it('reads an order in a tracked coin strictly when it was paid in an untracked coin', async () => {
    const page = await readOrders(orderOf('USDT', fundsIn('XYZ')));

    expect(page.rows).toMatchObject([{ currency: 'USDT', fundsDetail: [{ currency: 'XYZ' }] }]);
    expect(page.untracked).toEqual([]);
  });

  it('reports an order whose coins are all untracked by its tickers and time, never parsing it', async () => {
    const order = { ...orderOf('XYZ', [...fundsIn('xyz'), ...fundsIn('PEPE')]), amount: 12 };

    const page = await readOrders(order);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([{ tickers: ['XYZ', 'PEPE'], transactionTime: PAID_AT }]);
    expect(page.gathered).toBe(1);
  });

  it('reads a coin that only shares a fiat code with the app as untracked', async () => {
    const page = await readOrders(orderOf('SCR', fundsIn('SCR')));

    expect(page.untracked).toEqual([{ tickers: ['SCR'], transactionTime: PAID_AT }]);
  });

  it('lists no ticker the funds of an untracked order name with no usable currency', async () => {
    const funds = ['x', null, { currency: 7, amount: '1' }, ...fundsIn('  ')];

    const page = await readOrders(orderOf('XYZ', funds));

    expect(page.untracked).toEqual([{ tickers: ['XYZ'], transactionTime: PAID_AT }]);
    expect(page.unreadable).toEqual([]);
  });

  it.each([
    ['a string', 'soon'],
    ['missing', undefined],
    ['not finite', Number.POSITIVE_INFINITY],
    ['null', null],
  ])(
    'reports an untracked order whose time is %s with no time, never an error',
    async (_label, time) => {
      const page = await readOrders({ ...orderOf('XYZ', fundsIn('XYZ')), transactionTime: time });

      expect(page.untracked).toEqual([{ tickers: ['XYZ'], transactionTime: undefined }]);
      expect(page.unreadable).toEqual([]);
    },
  );

  it.each([
    ['an empty currency', ''],
    ['a currency of spaces', '   '],
    ['no currency', undefined],
    ['a currency that is not text', 7],
  ])('owes the point of an order with %s, never listing it', async (_label, currency) => {
    const page = await readOrders(orderOf(currency, fundsIn('USDT')));

    expect(page.rows).toEqual([]);
    expect(page.untracked).toEqual([]);
    expect(page.unreadable).toEqual([{ time: PAID_AT }]);
  });

  it('owes the point of a tracked order whose funds entry has a blank currency', async () => {
    const page = await readOrders(orderOf('USDT', [...fundsIn('USDT'), ...fundsIn('')]));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: PAID_AT }]);
  });

  it('counts each order of a page once, whichever of the three it is', async () => {
    const page = await readOrders(
      orderOf('USDT', fundsIn('USDT')),
      orderOf('XYZ', fundsIn('XYZ')),
      orderOf(7, []),
    );

    expect(page.rows).toHaveLength(1);
    expect(page.untracked).toHaveLength(1);
    expect(page.unreadable).toHaveLength(1);
    expect(page.gathered).toBe(3);
  });
});
