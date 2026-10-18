import { DAY_MS } from '@kiko/dates';
import type { CryptoCurrency, Currency } from '@kiko/currency/currency';

import type { HistoryRateEntry } from '../history-entry';
import { createBinanceMarketClient } from '../binance-market';
import { type CryptoHistory, CryptoHistoryFailure } from '../coingecko-history';

import { type BackfillDeps, composeHistoryRows, runBackfill } from './history-backfill';

const day = (index: number) => Date.UTC(2026, 8, 1) + index * DAY_MS;

type StoredRow = { base: string; quote: string; day: number; rate: string; source: string };

type Reply = {
  closes?: number[];
  status?: number;
  headers?: Record<string, string>;
  throws?: boolean;
  firstDayIndex?: number;
};

const nbuEntries = [0, 1, 2].flatMap((index) => [
  { base: 'USD', quote: 'UAH', day: day(index), rate: 40 + index, source: 'nbu' },
  { base: 'EUR', quote: 'UAH', day: day(index), rate: 43 + index, source: 'nbu' },
]) as HistoryRateEntry[];

const usdtEntries: HistoryRateEntry[] = [0, 1, 2].map((index) => ({
  base: 'USDT',
  quote: 'USD',
  day: day(index),
  rate: 1 + index / 1000,
  source: 'coingecko',
}));

const failed = (failedCurrencies: CryptoCurrency[], rateLimited: CryptoCurrency[] = []) => ({
  entries: [] as HistoryRateEntry[],
  failedCurrencies,
  rateLimitedCurrencies: rateLimited,
});

const klinesOf = (reply: Reply) =>
  (reply.closes ?? []).map((close, offset) => [
    day((reply.firstDayIndex ?? 0) + offset),
    '0',
    '0',
    '0',
    String(close),
  ]);

const binanceFetchOf = (replies: Record<string, Reply>) => {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    const symbol = url.split('symbol=')[1]?.split('&')[0] ?? '';
    const reply = replies[symbol] ?? { status: 400 };

    if (reply.throws) {
      throw new TypeError('offline');
    }
    const status = reply.status ?? 200;

    return {
      ok: status === 200,
      status,
      headers: new Headers(reply.headers),
      json: async () => (status === 200 ? klinesOf(reply) : { code: -1121 }),
    };
  }) as unknown as typeof fetch;

  return { urls, fetchImpl };
};

let keyCounter = 0;

const run = async (input: {
  fiat: Currency[];
  held: CryptoCurrency[];
  crypto: CryptoHistory | Error;
  binance: Record<string, Reply>;
  nbuFails?: boolean;
  overrides?: Partial<BackfillDeps>;
}) => {
  const captured: StoredRow[][] = [];
  const nbuCalls: Currency[][] = [];
  const cursors: (string | null)[] = [];
  const marks: unknown[] = [];
  keyCounter += 1;
  const binance = binanceFetchOf(input.binance);
  const deps: BackfillDeps = {
    earliestDay: day(0),
    lastBackfilledDay: null,
    today: day(2),
    historyCurrencies: async () => ({ fiatCurrencies: input.fiat, cryptoCurrencies: input.held }),
    fetchNbuHistory: async (currencies) => {
      nbuCalls.push(currencies);

      if (input.nbuFails) {
        throw new Error('NBU down');
      }

      return {
        entries: nbuEntries.filter((entry) => currencies.includes(entry.base)),
        failedCurrencies: [],
      };
    },
    fetchCryptoHistory: async () => {
      if (input.crypto instanceof Error) {
        throw input.crypto;
      }

      return input.crypto;
    },
    upsertMany: async (rows: StoredRow[]) => {
      captured.push(rows);
    },
    lastBackfilledDayByCurrency: {},
    readHistoryBackfillCursor: async () => null,
    writeHistoryBackfillCursor: async (cursor) => {
      cursors.push(cursor);
    },
    readSettledHistory: async () => ({}),
    writeSettledHistory: async (additions) => {
      marks.push(additions);
    },
    binanceMarket: createBinanceMarketClient({
      fetchImpl: binance.fetchImpl,
      now: () => day(2),
      sleep: async () => {},
      cooldownKey: `history-backfill-binance-fallback-${keyCounter}`,
    }),
    knownEmptyCurrencies: new Set<Currency>(),
    ...input.overrides,
  };
  const status = await runBackfill(deps);
  const rows = captured.flat();

  return {
    binance,
    cursors,
    marks,
    nbuCalls,
    rows,
    status,
    rowsOf: (base: string) => rows.filter((row) => row.base === base),
  };
};

describe('runBackfill — the Binance public history fallback', () => {
  it("prices a coin whose CoinGecko request failed through USDT's own history", async () => {
    const { rowsOf, status, binance } = await run({
      fiat: ['USD'],
      held: ['ETH', 'USDT'],
      crypto: { ...failed(['ETH']), entries: usdtEntries },
      binance: { ETHUSDT: { closes: [3_000, 3_100, 3_200] } },
    });

    expect(rowsOf('ETH')).toEqual(
      [3_000, 3_100, 3_200].map((close, index) => ({
        base: 'ETH',
        quote: 'UAH',
        day: day(index),
        rate: String(close * ((1 + index / 1000) * (40 + index))),
        source: 'binance',
      })),
    );
    expect(rowsOf('USDT').every((row) => row.source === 'coingecko')).toBe(true);
    expect(status.state).toBe('complete');
    expect(binance.urls).toHaveLength(1);
    expect(binance.urls[0]).toContain('/api/v3/klines?symbol=ETHUSDT&interval=1d');
    expect(binance.urls[0]).toContain(`startTime=${day(0)}&endTime=${day(2) + DAY_MS - 1}&limit=3`);
  });

  it('prices through EURUSDT and the EUR history of each day when USDT has no history', async () => {
    const { rowsOf, nbuCalls, rows, status } = await run({
      fiat: ['USD'],
      held: ['ETH'],
      crypto: new CryptoHistoryFailure([]),
      binance: {
        ETHUSDT: { closes: [3_000, 3_100, 3_200] },
        EURUSDT: { closes: [1.08, 1.1, 1.12] },
      },
    });

    expect(rowsOf('ETH')).toEqual(
      [3_000, 3_100, 3_200].map((close, index) => ({
        base: 'ETH',
        quote: 'UAH',
        day: day(index),
        rate: String(close * ((43 + index) / [1.08, 1.1, 1.12][index])),
        source: 'binance',
      })),
    );
    expect(nbuCalls).toEqual([['USD'], ['EUR']]);
    expect(rows.map((row) => row.base)).not.toContain('EUR');
    expect(status.state).toBe('complete');
  });

  it('asks NBU for no EUR when the fiat answer already has it', async () => {
    const { nbuCalls } = await run({
      fiat: ['USD', 'EUR'],
      held: ['ETH'],
      crypto: failed(['ETH']),
      binance: {
        ETHUSDT: { closes: [3_000, 3_100, 3_200] },
        EURUSDT: { closes: [1.08, 1.1, 1.12] },
      },
    });

    expect(nbuCalls).toEqual([['USD', 'EUR']]);
  });

  it('prices a coin CoinGecko answered with nothing', async () => {
    const { rowsOf } = await run({
      fiat: ['USD'],
      held: ['ETH', 'USDT'],
      crypto: { ...failed([]), entries: usdtEntries },
      binance: { ETHUSDT: { closes: [3_000, 3_100, 3_200] } },
    });

    expect(rowsOf('ETH')).toHaveLength(3);
  });

  it('prices USDT itself through EURUSDT when its CoinGecko history failed', async () => {
    const { rowsOf } = await run({
      fiat: ['USD'],
      held: ['USDT'],
      crypto: failed(['USDT']),
      binance: { EURUSDT: { closes: [1.08, 1.1, 1.12] } },
    });

    expect(rowsOf('USDT').map((row) => row.rate)).toEqual([
      String(43 / 1.08),
      String(44 / 1.1),
      String(45 / 1.12),
    ]);
    expect(rowsOf('USDT').map((row) => row.source)).toEqual(['binance', 'binance', 'binance']);
  });

  it('asks Binance nothing when CoinGecko answered every coin', async () => {
    const { binance } = await run({
      fiat: ['USD'],
      held: ['USDT'],
      crypto: { ...failed([]), entries: usdtEntries },
      binance: {},
    });

    expect(binance.urls).toEqual([]);
  });

  it('asks Binance nothing when NBU gave no fiat anchor', async () => {
    const { binance, status } = await run({
      fiat: ['USD'],
      held: ['ETH'],
      crypto: failed(['ETH']),
      nbuFails: true,
      binance: { ETHUSDT: { closes: [3_000] } },
    });

    expect(binance.urls).toEqual([]);
    expect(status.state).toBe('failed');
  });

  it('keeps a coin neither source priced failed, and stores the rows of the others', async () => {
    const { rowsOf, status } = await run({
      fiat: ['USD'],
      held: ['ETH', 'SOL', 'USDT'],
      crypto: { ...failed(['ETH', 'SOL']), entries: usdtEntries },
      binance: { SOLUSDT: { closes: [150, 151, 152] } },
    });

    expect(rowsOf('SOL')).toHaveLength(3);
    expect(rowsOf('ETH')).toEqual([]);
    expect(status.state).toBe('failed');
  });

  it("labels a row composed from a Binance series 'binance', never 'coingecko'", () => {
    const entries: HistoryRateEntry[] = [
      { base: 'ETH', quote: 'UAH', day: day(0), rate: 120_000, source: 'binance' },
      { base: 'BTC', quote: 'USD', day: day(0), rate: 65_000, source: 'coingecko' },
      { base: 'USD', quote: 'UAH', day: day(0), rate: 40, source: 'nbu' },
    ];

    expect(composeHistoryRows(entries, [day(0)])).toEqual([
      { base: 'ETH', quote: 'UAH', day: day(0), rate: '120000', source: 'binance' },
      { base: 'USD', quote: 'UAH', day: day(0), rate: '40', source: 'nbu' },
      { base: 'BTC', quote: 'UAH', day: day(0), rate: '2600000', source: 'coingecko' },
    ]);
  });

  it('moves the rotation cursor past a rate-limited coin Binance answered', async () => {
    const { cursors } = await run({
      fiat: ['USD'],
      held: ['ETH', 'SOL', 'USDT'],
      crypto: { ...failed(['ETH', 'SOL'], ['ETH', 'SOL']), entries: usdtEntries },
      binance: { ETHUSDT: { closes: [3_000, 3_100, 3_200] } },
    });

    expect(cursors).toEqual(['SOL']);
  });

  it('earns the settled mark of a coin Binance listed after the span start', async () => {
    const { marks } = await run({
      fiat: ['USD'],
      held: ['ETH', 'USDT'],
      crypto: { ...failed(['ETH']), entries: usdtEntries },
      binance: { ETHUSDT: { closes: [3_100, 3_200], firstDayIndex: 1 } },
    });

    expect(marks).toEqual([{ ETH: { start: day(0), firstDay: day(1) } }]);
  });

  describe.each([451, 403, 418, 429])('HTTP %i from Binance', (status) => {
    it('leaves the coin unpriced, reports failed, and stores the rows CoinGecko gave', async () => {
      const result = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed(['ETH']), entries: usdtEntries },
        binance: { ETHUSDT: { status, headers: { 'Retry-After': '30' } } },
      });

      expect(result.status.state).toBe('failed');
      expect(result.rowsOf('ETH')).toEqual([]);
      expect(result.rowsOf('USDT')).toHaveLength(3);
    });
  });

  it.each([418, 429])(
    'makes exactly one request for the whole run after an HTTP %i, however many coins failed',
    async (status) => {
      const { binance } = await run({
        fiat: ['USD'],
        held: ['ETH', 'SOL', 'XRP', 'USDT'],
        crypto: { ...failed(['ETH', 'SOL', 'XRP']), entries: usdtEntries },
        binance: {
          ETHUSDT: { status, headers: { 'Retry-After': '30' } },
          SOLUSDT: { closes: [150] },
        },
      });

      expect(binance.urls).toHaveLength(1);
    },
  );

  it.each([
    ['a network error', { throws: true }],
    ['an unlisted symbol', { status: 400 }],
    ['an empty answer', { closes: [] }],
  ] satisfies [string, Reply][])('leaves the coin unpriced on %s', async (_label, reply) => {
    const { rowsOf, status } = await run({
      fiat: ['USD'],
      held: ['ETH', 'USDT'],
      crypto: { ...failed(['ETH']), entries: usdtEntries },
      binance: { ETHUSDT: reply },
    });

    expect(rowsOf('ETH')).toEqual([]);
    expect(status.state).toBe('failed');
  });

  it('prices no stablecoin 1:1 when USDT has no history from either source', async () => {
    const { rows } = await run({
      fiat: ['USD'],
      held: ['USDC', 'USDT'],
      crypto: failed(['USDC', 'USDT']),
      binance: { USDCUSDT: { closes: [0.9996, 0.9997, 0.9998] }, EURUSDT: { status: 451 } },
    });

    expect(rows.filter((row) => row.base === 'USDC' || row.base === 'USDT')).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });
});
