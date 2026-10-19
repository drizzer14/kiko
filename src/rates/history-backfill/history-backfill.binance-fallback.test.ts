import { DAY_MS } from '@kiko/dates';
import type { CurrencyRateHistoryRow } from '@kiko/db';
import type { CryptoCurrency, Currency } from '@kiko/currency/currency';

import {
  type BinanceMarketClient,
  type DailyClose,
  createBinanceMarketClient,
} from '../binance-market';
import type { NbuHistory } from '../nbu-history';
import type { HistoryRateEntry } from '../history-entry';
import { type CryptoHistory, CryptoHistoryFailure } from '../coingecko-history';

import {
  type BackfillDeps,
  composeHistoryRows,
  deriveBinanceOnlyCurrencies,
  deriveFirstBackfilledDayByCurrency,
  deriveLastBackfilledDay,
  deriveLastBackfilledDayByCurrency,
  runBackfill,
} from './history-backfill';
import { withBinanceFallback } from './history-backfill.binance-fallback';

const day = (index: number) => Date.UTC(2026, 8, 1) + index * DAY_MS;

type StoredRow = {
  base: Currency;
  quote: string;
  day: number;
  rate: string;
  source: CurrencyRateHistoryRow['source'];
};

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

const euroRoutedRows = [3_000, 3_100, 3_200].map((close, index) => ({
  base: 'ETH',
  quote: 'UAH',
  day: day(index),
  rate: String(close * ((43 + index) / [1.08, 1.1, 1.12][index])),
  source: 'binance',
}));

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

    expect(rowsOf('ETH')).toEqual(euroRoutedRows);
    expect(nbuCalls).toEqual([['USD'], ['EUR']]);
    expect(rows.map((row) => row.base)).not.toContain('EUR');
    expect(status.state).toBe('complete');
  });

  it('prices through the EUR rows the fiat answer already has, asking NBU for no EUR', async () => {
    const { nbuCalls, rowsOf, status } = await run({
      fiat: ['USD', 'EUR'],
      held: ['ETH'],
      crypto: failed(['ETH']),
      binance: {
        ETHUSDT: { closes: [3_000, 3_100, 3_200] },
        EURUSDT: { closes: [1.08, 1.1, 1.12] },
      },
    });

    expect(nbuCalls).toEqual([['USD', 'EUR']]);
    expect(rowsOf('ETH')).toEqual(euroRoutedRows);
    expect(status.state).toBe('complete');
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

  it('prices a coin of a CoinGecko leg that answered no entry at all', async () => {
    const { rowsOf, status } = await run({
      fiat: ['USD'],
      held: ['ETH'],
      crypto: failed([]),
      binance: {
        ETHUSDT: { closes: [3_000, 3_100, 3_200] },
        EURUSDT: { closes: [1.08, 1.1, 1.12] },
      },
    });

    expect(rowsOf('ETH')).toEqual(euroRoutedRows);
    expect(status.state).toBe('complete');
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

  it('asks Binance nothing when CoinGecko answered each of several coins', async () => {
    const { binance } = await run({
      fiat: ['USD'],
      held: ['BTC', 'USDT'],
      crypto: {
        ...failed([]),
        entries: [
          ...usdtEntries,
          ...[0, 1, 2].map((index) => ({
            base: 'BTC',
            quote: 'USD',
            day: day(index),
            rate: 65_000 + index,
            source: 'coingecko',
          })),
        ] as HistoryRateEntry[],
      },
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

  describe('the rotation cursor of a coin Binance priced from a later day', () => {
    const answered = ['ADA', 'BTC'].flatMap((base) =>
      [0, 1, 2].map((index) => ({
        base,
        quote: 'USD',
        day: day(index),
        rate: 1 + index,
        source: 'coingecko',
      })),
    ) as HistoryRateEntry[];

    it('keeps a rate-limited coin at the head of the next run, so CoinGecko answers it in the end', async () => {
      let cursor: string | null = null;
      const asked: CryptoCurrency[][] = [];
      const everyRun = {
        readHistoryBackfillCursor: async () => cursor,
        writeHistoryBackfillCursor: async (next: string | null) => {
          cursor = next;
        },
        fetchCryptoHistory: async (_days: number, currencies: CryptoCurrency[]) => {
          asked.push(currencies);

          return { ...failed(['SOL'], ['SOL']), entries: answered };
        },
      };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await run({
          fiat: ['USD'],
          held: ['ADA', 'BTC', 'SOL'],
          crypto: failed([]),
          binance: {
            SOLUSDT: { closes: [150, 151], firstDayIndex: 1 },
            EURUSDT: { closes: [1.08, 1.1, 1.12] },
          },
          overrides: everyRun,
        });
      }

      expect(asked).toEqual([
        ['ADA', 'BTC', 'SOL'],
        ['SOL', 'ADA', 'BTC'],
      ]);
    });

    it('moves the cursor past a rate-limited coin whose Binance series reaches the requested start', async () => {
      const { cursors } = await run({
        fiat: ['USD'],
        held: ['ADA', 'BTC', 'SOL'],
        crypto: { ...failed(['SOL'], ['SOL']), entries: answered },
        binance: {
          SOLUSDT: { closes: [150, 151, 152] },
          EURUSDT: { closes: [1.08, 1.1, 1.12] },
        },
      });

      expect(cursors).toEqual([]);
    });
  });

  describe('an empty CoinGecko answer for a coin Binance prices from a later day', () => {
    const runWithRows = async (overrides: Partial<BackfillDeps>) => {
      const asked: CryptoCurrency[][] = [];
      const result = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed([]), entries: usdtEntries },
        binance: {},
        overrides: {
          lastBackfilledDay: day(2),
          lastBackfilledDayByCurrency: { ETH: day(2), USDT: day(2), USD: day(2) },
          firstBackfilledDayByCurrency: { ETH: day(1), USDT: day(0), USD: day(0) },
          fetchCryptoHistory: async (_days, currencies) => {
            asked.push(currencies);

            return { ...failed([]), entries: usdtEntries };
          },
          ...overrides,
        },
      });

      return { ...result, asked };
    };

    it('holds the empty mark run after run until it expires, then asks CoinGecko again', async () => {
      const settledStore: Record<string, unknown> = {};
      const stored: StoredRow[] = [];
      const asked: CryptoCurrency[][] = [];
      const askedDays: number[] = [];
      const runOn = async (today: number, lastIndex: number) => {
        asked.length = 0;
        askedDays.length = 0;
        const writes: unknown[] = [];
        const result = await run({
          fiat: ['USD'],
          held: ['ETH', 'USDT'],
          crypto: failed([]),
          binance: {
            ETHUSDT: {
              closes: Array.from({ length: lastIndex }, (_, index) => 3_000 + index),
              firstDayIndex: 1,
            },
          },
          overrides: {
            today,
            lastBackfilledDay: deriveLastBackfilledDay(stored),
            lastBackfilledDayByCurrency: deriveLastBackfilledDayByCurrency(stored),
            firstBackfilledDayByCurrency: deriveFirstBackfilledDayByCurrency(stored),
            binanceOnlyCurrencies: deriveBinanceOnlyCurrencies(stored),
            readSettledHistory: async () => ({ ...settledStore }),
            writeSettledHistory: async (additions) => {
              writes.push(additions);
              Object.assign(settledStore, additions);
            },
            fetchCryptoHistory: async (days, currencies) => {
              asked.push(currencies);
              askedDays.push(days);

              return { ...failed([]), entries: usdtEntries };
            },
          },
        });
        stored.push(...result.rows);

        return { ...result, writes };
      };

      const first = await runOn(day(2), 2);

      expect(asked).toEqual([['ETH', 'USDT']]);
      expect(first.writes).toEqual([{ ETH: { start: day(0), firstDay: null, checkedOn: day(2) } }]);
      expect(first.rowsOf('ETH').map((row) => row.day)).toEqual([day(1), day(2)]);

      const second = await runOn(day(2), 2);

      expect(asked).toEqual([]);
      expect(second.nbuCalls).toEqual([]);
      expect(second.binance.urls).toEqual([]);

      const nextDay = await runOn(day(3), 3);

      expect(asked).toEqual([['ETH', 'USDT']]);
      expect(askedDays).toEqual([1]);
      expect(nextDay.writes).toEqual([]);
      expect(nextDay.rowsOf('ETH').map((row) => row.day)).toEqual([day(3)]);

      const afterExpiry = await runOn(day(9), 9);

      expect(asked.flat()).toContain('ETH');
      expect(afterExpiry.writes).toEqual([
        { ETH: { start: day(0), firstDay: null, checkedOn: day(9) } },
      ]);

      const next = await runOn(day(9), 9);

      expect(asked).toEqual([]);
      expect(next.nbuCalls).toEqual([]);
    });

    it('asks CoinGecko again once a row of the coin is not from Binance', async () => {
      const { nbuCalls } = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed([]), entries: usdtEntries },
        binance: {},
        overrides: {
          lastBackfilledDay: day(2),
          lastBackfilledDayByCurrency: { ETH: day(2), USDT: day(2) },
          firstBackfilledDayByCurrency: { ETH: day(1), USDT: day(0) },
          binanceOnlyCurrencies: new Set(),
          readSettledHistory: async () => ({
            ETH: { start: day(0), firstDay: null, checkedOn: day(2) },
          }),
        },
      });

      expect(nbuCalls).toEqual([['USD']]);
    });

    it('asks CoinGecko again once Binance rows of the coin have no mark at all', async () => {
      const { nbuCalls, asked } = await runWithRows({
        binanceOnlyCurrencies: new Set<Currency>(['ETH']),
        readSettledHistory: async () => ({}),
      });

      expect(nbuCalls).toEqual([['USD']]);
      expect(asked).toEqual([['ETH']]);
    });

    it('asks CoinGecko again for a start before the one the empty mark was stamped for', async () => {
      const { nbuCalls, asked } = await runWithRows({
        binanceOnlyCurrencies: new Set<Currency>(['ETH']),
        readSettledHistory: async () => ({
          ETH: { start: day(1), firstDay: null, checkedOn: day(2) },
        }),
      });

      expect(nbuCalls).toEqual([['USD']]);
      expect(asked).toEqual([['ETH']]);
    });

    it('asks CoinGecko again when the run is not told which coins hold only Binance rows', async () => {
      const { nbuCalls } = await runWithRows({
        readSettledHistory: async () => ({
          ETH: { start: day(0), firstDay: null, checkedOn: day(2) },
        }),
      });

      expect(nbuCalls).toEqual([['USD']]);
    });

    it('leaves a held coin with an unexpired empty mark out of a whole-span run a new coin forces', async () => {
      const asked: CryptoCurrency[][] = [];
      const writes: unknown[] = [];

      await run({
        fiat: ['USD'],
        held: ['BTC', 'ETH', 'USDT'],
        crypto: failed([]),
        binance: {},
        overrides: {
          lastBackfilledDay: day(2),
          lastBackfilledDayByCurrency: { ETH: day(2), USDT: day(2), USD: day(2) },
          firstBackfilledDayByCurrency: { ETH: day(1), USDT: day(0), USD: day(0) },
          binanceOnlyCurrencies: new Set<Currency>(['ETH']),
          readSettledHistory: async () => ({
            ETH: { start: day(0), firstDay: null, checkedOn: day(2) },
          }),
          writeSettledHistory: async (additions) => {
            writes.push(additions);
          },
          fetchCryptoHistory: async (_days, currencies) => {
            asked.push(currencies);

            return { ...failed([]), entries: usdtEntries };
          },
        },
      });

      expect(asked).toEqual([['BTC']]);
      expect(writes.flatMap((additions) => Object.keys(additions as object))).not.toContain('ETH');
    });
  });

  describe('the settled marks', () => {
    it('earns none for a coin CoinGecko failed, though Binance priced it from a later day', async () => {
      const { marks, rowsOf } = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed(['ETH']), entries: usdtEntries },
        binance: { ETHUSDT: { closes: [3_100, 3_200], firstDayIndex: 1 } },
      });

      expect(marks).toEqual([]);
      expect(rowsOf('ETH').map((row) => row.day)).toEqual([day(1), day(2)]);
    });

    it('earns none for a coin of a CoinGecko leg that failed whole', async () => {
      const { marks, rowsOf } = await run({
        fiat: ['USD'],
        held: ['ETH'],
        crypto: new CryptoHistoryFailure(['ETH']),
        binance: {
          ETHUSDT: { closes: [3_100, 3_200], firstDayIndex: 1 },
          EURUSDT: { closes: [1.08, 1.1, 1.12] },
        },
      });

      expect(marks).toEqual([]);
      expect(rowsOf('ETH')).toHaveLength(2);
    });

    it('keeps the expiring empty mark of a coin CoinGecko answered with nothing', async () => {
      const { marks, rowsOf } = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed([]), entries: usdtEntries },
        binance: { ETHUSDT: { closes: [3_100, 3_200], firstDayIndex: 1 } },
      });

      expect(marks).toEqual([{ ETH: { start: day(0), firstDay: null, checkedOn: day(2) } }]);
      expect(rowsOf('ETH')).toHaveLength(2);
    });

    it('earns no mark for a coin with stored rows when the run is not told which are Binance only', async () => {
      const { marks } = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed([]), entries: usdtEntries },
        binance: {},
        overrides: {
          lastBackfilledDay: day(2),
          lastBackfilledDayByCurrency: { ETH: day(2), USDT: day(2), USD: day(2) },
          firstBackfilledDayByCurrency: { ETH: day(1), USDT: day(0), USD: day(0) },
        },
      });

      expect(marks).toEqual([]);
    });

    it('asks CoinGecko for the coin again after a 429 that Binance covered from a later day', async () => {
      const settledStore: Record<string, unknown> = {};
      const stored = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed(['ETH'], ['ETH']), entries: usdtEntries },
        binance: { ETHUSDT: { closes: [3_100, 3_200], firstDayIndex: 1 } },
        overrides: {
          readSettledHistory: async () => ({ ...settledStore }),
          writeSettledHistory: async (additions) => {
            Object.assign(settledStore, additions);
          },
        },
      });
      const asked: CryptoCurrency[][] = [];

      await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: failed([]),
        binance: {},
        overrides: {
          lastBackfilledDay: deriveLastBackfilledDay(stored.rows),
          lastBackfilledDayByCurrency: deriveLastBackfilledDayByCurrency(stored.rows),
          firstBackfilledDayByCurrency: deriveFirstBackfilledDayByCurrency(stored.rows),
          readSettledHistory: async () => ({ ...settledStore }),
          fetchCryptoHistory: async (_days, currencies) => {
            asked.push(currencies);

            return { ...failed([]), entries: usdtEntries };
          },
        },
      });

      expect(asked.flat()).toContain('ETH');
    });
  });

  describe('a pair that stopped trading', () => {
    it('gives a coin no row when its last candle is 30 days before the run', async () => {
      const { rowsOf, status } = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed(['ETH']), entries: usdtEntries },
        binance: { ETHUSDT: { closes: [3_000] } },
        overrides: { today: day(30) },
      });

      expect(rowsOf('ETH')).toEqual([]);
      expect(status.state).toBe('failed');
    });

    it('gives a coin no row when its last candle is older than yesterday', async () => {
      const { rowsOf } = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed(['ETH']), entries: usdtEntries },
        binance: { ETHUSDT: { closes: [3_000] } },
      });

      expect(rowsOf('ETH')).toEqual([]);
    });

    it('prices a coin whose last candle is yesterday', async () => {
      const { rowsOf } = await run({
        fiat: ['USD'],
        held: ['ETH', 'USDT'],
        crypto: { ...failed(['ETH']), entries: usdtEntries },
        binance: { ETHUSDT: { closes: [3_000, 3_100] } },
      });

      expect(rowsOf('ETH').map((row) => row.day)).toEqual([day(0), day(1), day(2)]);
      expect(rowsOf('ETH').every((row) => row.source === 'binance')).toBe(true);
    });

    it.each<[string, CryptoCurrency[]]>([
      ['USDT itself', ['USDT']],
      ['a coin that needs the EURUSDT route', ['ETH']],
    ])('prices %s through no EURUSDT whose last candle is old', async (_label, held) => {
      const { rows } = await run({
        fiat: ['USD'],
        held,
        crypto: failed(held),
        binance: { ETHUSDT: { closes: [3_000, 3_100, 3_200] }, EURUSDT: { closes: [1.08] } },
      });

      expect(rows.filter((row) => held.includes(row.base as CryptoCurrency))).toEqual([]);
    });
  });

  describe('a Binance fallback that throws', () => {
    const throwing = (answers: Record<string, DailyClose[]> = {}): BinanceMarketClient => ({
      currentPrice: async () => undefined,
      dailyCloses: async (symbol) => {
        const closes = answers[symbol];

        if (closes === undefined) {
          throw new TypeError(`fallback broke on ${symbol}`);
        }

        return closes;
      },
    });

    it.each<[string, CryptoCurrency[], CryptoHistory, BinanceMarketClient]>([
      [
        'the coin symbol',
        ['ETH', 'USDT'],
        { ...failed(['ETH']), entries: usdtEntries },
        throwing(),
      ],
      ['the EURUSDT route', ['USDT'], failed(['USDT']), throwing()],
      [
        'the EURUSDT route of a coin whose own symbol answered',
        ['ETH'],
        failed(['ETH']),
        throwing({ ETHUSDT: [{ day: day(0), close: 3_000 }] }),
      ],
    ])(
      'keeps the NBU and CoinGecko rows when it throws on %s',
      async (_label, held, crypto, client) => {
        const { rows, rowsOf, status } = await run({
          fiat: ['USD'],
          held,
          crypto,
          binance: {},
          overrides: { binanceMarket: client },
        });

        expect(rowsOf('USD')).toHaveLength(3);
        expect(rowsOf('ETH')).toEqual([]);
        expect(rows.some((row) => row.source === 'binance')).toBe(false);
        expect(status.state).toBe('failed');
      },
    );
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

describe('withBinanceFallback — the leg it returns', () => {
  const dailyCloses = jest.fn(
    async (symbol: string): Promise<DailyClose[] | undefined> =>
      symbol === 'ETHUSDT'
        ? [0, 1, 2].map((index) => ({ day: day(index), close: 3_000 + index }))
        : undefined,
  );
  const client: BinanceMarketClient = { currentPrice: async () => undefined, dailyCloses };
  const loadNbu = jest.fn();
  const range = { start: day(0), end: day(2) };
  const nbuResult: PromiseFulfilledResult<NbuHistory> = {
    status: 'fulfilled',
    value: { entries: [...nbuEntries, ...usdtEntries], failedCurrencies: [] },
  };
  const ethBinanceEntries = [0, 1, 2].map((index) => ({
    base: 'ETH',
    quote: 'UAH',
    day: day(index),
    rate: (3_000 + index) * ((1 + index / 1000) * (40 + index)),
    source: 'binance',
  }));

  beforeEach(() => {
    dailyCloses.mockClear();
  });

  it('adds the coins Binance priced and keeps the failures of the coins it did not', async () => {
    const cryptoResult: PromiseFulfilledResult<CryptoHistory> = {
      status: 'fulfilled',
      value: { entries: usdtEntries, failedCurrencies: ['ETH', 'SOL'], rateLimitedCurrencies: [] },
    };

    const result = await withBinanceFallback({
      requested: ['ETH', 'SOL'],
      nbuResult,
      cryptoResult,
      range,
      loadNbu,
      client,
    });

    expect(result).toEqual({
      status: 'fulfilled',
      value: {
        entries: [...usdtEntries, ...ethBinanceEntries],
        failedCurrencies: ['SOL'],
        rateLimitedCurrencies: [],
      },
    });
    expect(loadNbu).not.toHaveBeenCalled();
  });

  it('prices every requested coin of a CoinGecko leg that rejected with no rate limit', async () => {
    const result = await withBinanceFallback({
      requested: ['ETH'],
      nbuResult,
      cryptoResult: { status: 'rejected', reason: new Error('network down') },
      range,
      loadNbu,
      client,
    });

    expect(result).toEqual({
      status: 'fulfilled',
      value: { entries: ethBinanceEntries, failedCurrencies: [], rateLimitedCurrencies: [] },
    });
  });

  it('returns the CoinGecko leg itself, asking Binance nothing, when NBU gave no anchor', async () => {
    const cryptoResult: PromiseFulfilledResult<CryptoHistory> = {
      status: 'fulfilled',
      value: failed(['ETH']),
    };

    await expect(
      withBinanceFallback({
        requested: ['ETH'],
        nbuResult: { status: 'rejected', reason: new Error('NBU down') },
        cryptoResult,
        range,
        loadNbu,
        client,
      }),
    ).resolves.toBe(cryptoResult);
    expect(dailyCloses).not.toHaveBeenCalled();
  });
});
