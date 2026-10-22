import {
  type BinanceExchangeSymbol,
  BinanceHistoryParseError,
  type ExchangeSymbolsPage,
  fetchExchangeSymbols,
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';

type SentRequest = { url: string; init: { method?: string; headers?: Record<string, string> } };

const wireSymbolOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  symbol: 'ETHBTC',
  status: 'TRADING',
  baseAsset: 'ETH',
  baseAssetPrecision: 8,
  quoteAsset: 'BTC',
  quotePrecision: 8,
  orderTypes: ['LIMIT', 'MARKET'],
  isSpotTradingAllowed: true,
  filters: [],
  permissions: [],
  permissionSets: [['SPOT', 'MARGIN']],
  ...overrides,
});

const symbolOf = (overrides: Partial<BinanceExchangeSymbol> = {}): BinanceExchangeSymbol => ({
  symbol: 'ETHBTC',
  status: 'TRADING',
  baseAsset: 'ETH',
  quoteAsset: 'BTC',
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

const readList = (body: unknown, headers?: Headers): Promise<ExchangeSymbolsPage> =>
  fetchExchangeSymbols({ fetchImpl: answerFetch(body, { headers }) });

describe('fetchExchangeSymbols', () => {
  it('asks the public exchangeInfo without the permission sets and with no permissions filter, unsigned', async () => {
    const sent: SentRequest[] = [];
    const spyFetch = (async (url: string, init: SentRequest['init']) => {
      sent.push({ url, init });

      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ symbols: [] }) };
    }) as unknown as typeof fetch;

    await fetchExchangeSymbols({ fetchImpl: spyFetch });

    expect(sent).toEqual([
      {
        url: 'https://api.binance.com/api/v3/exchangeInfo?showPermissionSets=false',
        init: { method: 'GET', headers: { 'Cache-Control': 'no-store' } },
      },
    ]);
  });

  it('reads the four text fields of each symbol and the weight Binance reports', async () => {
    const page = await readList(
      {
        timezone: 'UTC',
        symbols: [
          wireSymbolOf(),
          wireSymbolOf({
            symbol: 'BTCUAH',
            status: 'BREAK',
            baseAsset: 'BTC',
            quoteAsset: 'UAH',
          }),
        ],
      },
      new Headers({ 'X-MBX-USED-WEIGHT-1M': '40' }),
    );

    expect(page).toEqual({
      symbols: [
        symbolOf(),
        symbolOf({ symbol: 'BTCUAH', status: 'BREAK', baseAsset: 'BTC', quoteAsset: 'UAH' }),
      ],
      unreadable: 0,
      usedApiWeight1m: 40,
    });
  });

  it('reads an empty list as no symbol, and no weight header as no weight', async () => {
    expect(await readList({ symbols: [] })).toEqual({
      symbols: [],
      unreadable: 0,
      usedApiWeight1m: undefined,
    });
  });

  it.each([
    ['a body that is not an object', []],
    ['a null body', null],
    ['a text body', 'symbols'],
    ['a body with no symbols', { timezone: 'UTC' }],
    ['symbols that is not an array', { symbols: { symbol: 'ETHBTC' } }],
    ['symbols that is null', { symbols: null }],
  ])('throws a parse error for %s', async (_name, body) => {
    await expect(readList(body)).rejects.toBeInstanceOf(BinanceHistoryParseError);
  });

  it.each([
    ['a symbol that is absent', { symbol: undefined }],
    ['a symbol that is a number', { symbol: 7 }],
    ['a status that is absent', { status: undefined }],
    ['a status that is null', { status: null }],
    ['a baseAsset that is absent', { baseAsset: undefined }],
    ['a baseAsset that is a number', { baseAsset: 1 }],
    ['a quoteAsset that is absent', { quoteAsset: undefined }],
    ['a quoteAsset that is an object', { quoteAsset: {} }],
  ])('leaves a symbol out and counts it when it has %s', async (_name, overrides) => {
    const page = await readList({
      symbols: [
        wireSymbolOf({ symbol: 'AAABTC', baseAsset: 'AAA' }),
        wireSymbolOf(overrides),
        wireSymbolOf({ symbol: 'ZZZBTC', baseAsset: 'ZZZ' }),
      ],
    });

    expect(page.symbols.map((entry) => entry.symbol)).toEqual(['AAABTC', 'ZZZBTC']);
    expect(page.unreadable).toBe(1);
  });

  it('counts an item that is no object as unreadable', async () => {
    const page = await readList({ symbols: [null, 'ETHBTC', 3, wireSymbolOf()] });

    expect(page.symbols).toEqual([symbolOf()]);
    expect(page.unreadable).toBe(3);
  });

  it.each([
    ['one item that is no symbol', [null]],
    ['every item without a symbol name', [wireSymbolOf({ symbol: undefined }), 'ETHBTC', 3]],
  ])(
    'throws a parse error when nothing reads and something does not: %s',
    async (_name, symbols) => {
      await expect(readList({ symbols })).rejects.toBeInstanceOf(BinanceHistoryParseError);
    },
  );

  it('reads a coin trimmed and upper-cased, and keeps the symbol as sent', async () => {
    const page = await readList({
      symbols: [wireSymbolOf({ symbol: 'ethBTC', baseAsset: ' eth ', quoteAsset: ' btc ' })],
    });

    expect(page.symbols).toEqual([symbolOf({ symbol: 'ethBTC' })]);
  });

  it('lists a symbol once however often Binance sends it', async () => {
    const page = await readList({
      symbols: [wireSymbolOf(), wireSymbolOf({ status: 'BREAK' }), wireSymbolOf()],
    });

    expect(page.symbols).toEqual([symbolOf()]);
    expect(page.unreadable).toBe(0);
  });

  it.each([
    [429, '30', 30_000],
    [418, '120', 120_000],
  ])(
    'throws the rate limit error for HTTP %s with its Retry-After',
    async (status, seconds, milliseconds) => {
      const error = await fetchExchangeSymbols({
        fetchImpl: answerFetch({}, { status, headers: new Headers({ 'Retry-After': seconds }) }),
      }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(BinanceRateLimitError);
      expect(error).toMatchObject({ status, retryAfterMs: milliseconds });
    },
  );

  it.each([
    [500, 'Binance request failed: 500'],
    [400, 'Binance request failed: 400'],
    [404, 'Binance request failed: 404'],
  ])('rejects as a request failure for HTTP %s', async (status, message) => {
    const error = await fetchExchangeSymbols({
      fetchImpl: answerFetch({}, { status }),
    }).catch((thrown: unknown) => thrown);

    expect(error).not.toBeInstanceOf(BinanceRateLimitError);
    expect(error).toMatchObject({ message });
  });
});
