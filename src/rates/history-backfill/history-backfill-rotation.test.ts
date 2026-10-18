import { DAY_MS } from '@kiko/dates';
import type { SettledHistory } from '@kiko/settings';
import { CURATED_COIN_CODES } from '@kiko/currency/coins';
import type { CryptoCurrency, Currency } from '@kiko/currency/currency';

import { cryptoCoinGeckoId } from '../coingecko-ids';
import type { HistoryRateEntry } from '../history-entry';
import { type CryptoHistory, CryptoHistoryFailure, fetchCryptoHistory } from '../coingecko-history';

import {
  type BackfillDeps,
  deriveLastBackfilledDay,
  deriveLastBackfilledDayByCurrency,
  runBackfill,
} from './history-backfill';

// Binance's public market data prices nothing here, so a coin left to the fallback never reaches
// the real network.
jest.mock('@kiko/rates/binance-market', () => ({
  ...jest.requireActual('@kiko/rates/binance-market'),
  createBinanceMarketClient: () => ({
    tickerPrice: async () => undefined,
    dailyCloses: async () => undefined,
  }),
}));

const day = (index: number) => Date.UTC(2026, 8, 1) + index * DAY_MS;
const TODAY = day(2);

const usdAnchors: HistoryRateEntry[] = [0, 1, 2].map((index) => ({
  base: 'USD',
  quote: 'UAH',
  day: day(index),
  rate: 40,
  source: 'nbu',
}));

const answered = (
  rateLimitedCurrencies: CryptoCurrency[] = [],
  otherFailedCurrencies: CryptoCurrency[] = [],
): CryptoHistory => ({
  entries: [],
  failedCurrencies: [...otherFailedCurrencies, ...rateLimitedCurrencies],
  rateLimitedCurrencies,
});

type CursorStore = { value: string | null };

// A run whose crypto leg is a stub: it records which coins were requested, in order, and what the
// run wrote as the next cursor.
const stubbedRun = async (input: {
  held: CryptoCurrency[];
  doneDays: Partial<Record<Currency, number>>;
  cursor: string | null;
  knownEmpty?: Set<Currency>;
  lastBackfilledDay?: number | null;
  earliestDay?: number;
  today?: number;
  firstDays?: Partial<Record<Currency, number>>;
  settled?: { value: SettledHistory };
  answer?: (currencies: CryptoCurrency[]) => Promise<CryptoHistory>;
  failSettledWrite?: boolean;
}) => {
  const requested: CryptoCurrency[][] = [];
  const cursor: CursorStore = { value: input.cursor };
  const cursorReads: number[] = [];
  const cursorWrites: (string | null)[] = [];
  const settledWrites: SettledHistory[] = [];
  const settled = input.settled ?? { value: {} };
  const deps: BackfillDeps = {
    earliestDay: input.earliestDay ?? day(0),
    // An explicit null is the span moving earlier: the window is the whole span again.
    lastBackfilledDay: input.lastBackfilledDay === undefined ? day(1) : input.lastBackfilledDay,
    today: input.today ?? TODAY,
    firstBackfilledDayByCurrency: input.firstDays,
    readSettledHistory: async () => settled.value,
    writeSettledHistory: async (additions) => {
      settledWrites.push(additions);

      if (input.failSettledWrite) {
        throw new Error('disk full');
      }

      settled.value = { ...settled.value, ...additions };
    },
    fetchNbuHistory: async () => ({ entries: usdAnchors, failedCurrencies: [] }),
    fetchCryptoHistory: async (_days, currencies) => {
      requested.push(currencies);

      return (input.answer ?? (async () => answered()))(currencies);
    },
    upsertMany: async () => {},
    historyCurrencies: async () => ({ fiatCurrencies: ['USD'], cryptoCurrencies: input.held }),
    lastBackfilledDayByCurrency: input.doneDays,
    knownEmptyCurrencies: input.knownEmpty ?? new Set(),
    readHistoryBackfillCursor: async () => {
      cursorReads.push(1);

      return cursor.value;
    },
    writeHistoryBackfillCursor: async (next) => {
      cursorWrites.push(next);
      cursor.value = next;
    },
  };

  const status = await runBackfill(deps);

  return { requested, cursor, cursorReads, cursorWrites, settledWrites, status };
};

describe('runBackfill — which crypto history it requests, and from where', () => {
  it('requests only the held coins whose own last day is before the day it fills', async () => {
    const { requested } = await stubbedRun({
      held: ['BTC', 'ETH', 'SOL'],
      doneDays: { USD: TODAY, BTC: TODAY, ETH: day(1) },
      cursor: null,
    });

    expect(requested).toEqual([['ETH', 'SOL']]);
  });

  it('leaves out a coin this run already knows has no data', async () => {
    const { requested } = await stubbedRun({
      held: ['BTC', 'ETH', 'SOL'],
      doneDays: { USD: TODAY },
      cursor: null,
      knownEmpty: new Set<Currency>(['ETH']),
    });

    expect(requested).toEqual([['BTC', 'SOL']]);
  });

  describe('when the span moves earlier', () => {
    const EIGHT: CryptoCurrency[] = ['ADA', 'BNB', 'BTC', 'DOGE', 'ETH', 'SOL', 'USDT', 'XRP'];
    const current = Object.fromEntries(EIGHT.map((coin) => [coin, TODAY]));
    const fromTheStart = Object.fromEntries(EIGHT.map((coin) => [coin, day(0)]));

    const SOL_FROM_DAY_ONE: CryptoHistory = {
      entries: [
        { base: 'SOL', quote: 'USD', day: day(1), rate: 1, source: 'coingecko' },
        { base: 'SOL', quote: 'USD', day: day(2), rate: 1, source: 'coingecko' },
      ],
      failedCurrencies: [],
      rateLimitedCurrencies: [],
    };

    it('requests only the coins that lack the earlier days', async () => {
      const { requested } = await stubbedRun({
        held: EIGHT,
        doneDays: { USD: TODAY, ...current },
        firstDays: { ...fromTheStart, SOL: day(1) },
        cursor: null,
        lastBackfilledDay: null,
      });

      expect(requested).toEqual([['SOL']]);
    });

    it('does not ask a young coin again, on the next launch either', async () => {
      const settled = { value: {} as SettledHistory };
      const run = () =>
        stubbedRun({
          held: EIGHT,
          doneDays: { USD: TODAY, ...current },
          firstDays: { ...fromTheStart, SOL: day(1) },
          cursor: null,
          lastBackfilledDay: null,
          settled,
          answer: async () => SOL_FROM_DAY_ONE,
        });

      expect((await run()).requested).toEqual([['SOL']]);
      expect(settled.value).toEqual({ SOL: { start: day(0), firstDay: day(1) } });
      expect((await run()).requested).toEqual([]);
      expect((await run()).requested).toEqual([]);
    });

    it('asks a young coin again when the span starts earlier than the one it settled for', async () => {
      const settled = { value: { SOL: { start: day(5), firstDay: day(6) } } as SettledHistory };
      const { requested } = await stubbedRun({
        held: ['SOL'],
        doneDays: { USD: TODAY, SOL: TODAY },
        firstDays: { SOL: day(6) },
        cursor: null,
        lastBackfilledDay: null,
        earliestDay: day(0),
        settled,
      });

      expect(requested).toEqual([['SOL']]);
    });

    it('asks a settled coin again when its stored rows start after the first answered day', async () => {
      const settled = { value: { SOL: { start: day(0), firstDay: day(1) } } as SettledHistory };
      const { requested } = await stubbedRun({
        held: ['SOL'],
        doneDays: { USD: TODAY, SOL: TODAY },
        firstDays: { SOL: day(2) },
        cursor: null,
        lastBackfilledDay: null,
        settled,
      });

      expect(requested).toEqual([['SOL']]);
    });

    it('asks a coin with an empty mark again once rows exist from a later day', async () => {
      const settled = {
        value: { SOL: { start: day(0), firstDay: null, checkedOn: TODAY } } as SettledHistory,
      };
      const { requested } = await stubbedRun({
        held: ['SOL'],
        doneDays: { USD: TODAY, SOL: TODAY },
        firstDays: { SOL: day(1) },
        cursor: null,
        lastBackfilledDay: null,
        settled,
      });

      expect(requested).toEqual([['SOL']]);
    });

    it('asks a coin whose empty mark started later than the span again', async () => {
      const settled = {
        value: { SOL: { start: day(1), firstDay: null, checkedOn: TODAY } } as SettledHistory,
      };
      const { requested } = await stubbedRun({
        held: ['SOL'],
        doneDays: { USD: TODAY, SOL: TODAY },
        cursor: null,
        lastBackfilledDay: null,
        settled,
      });

      expect(requested).toEqual([['SOL']]);
    });

    it('treats an empty mark as holding when no stored first days are known', async () => {
      const settled = {
        value: { SOL: { start: day(0), firstDay: null, checkedOn: TODAY } } as SettledHistory,
      };

      const { requested } = await stubbedRun({
        held: ['SOL'],
        doneDays: { USD: TODAY },
        cursor: null,
        lastBackfilledDay: null,
        settled,
      });

      expect(requested).toEqual([]);
    });

    it('does not count the days past the 365-day window as missing', async () => {
      const today = day(2000);
      const { requested } = await stubbedRun({
        held: ['BTC', 'ETH'],
        doneDays: { USD: today, BTC: today, ETH: today },
        firstDays: { BTC: today - 364 * DAY_MS, ETH: today - 300 * DAY_MS },
        cursor: null,
        lastBackfilledDay: null,
        earliestDay: day(0),
        today,
      });

      expect(requested).toEqual([['ETH']]);
    });
  });

  it('requests the held coins in code order, whatever order they are held in', async () => {
    const { requested } = await stubbedRun({
      held: ['SOL', 'BTC', 'ETH'],
      doneDays: {},
      cursor: null,
    });

    expect(requested).toEqual([['BTC', 'ETH', 'SOL']]);
  });

  it('requests nothing when every held coin is current', async () => {
    const { requested } = await stubbedRun({
      held: ['BTC', 'ETH'],
      doneDays: { USD: day(1), BTC: TODAY, ETH: TODAY },
      cursor: null,
    });

    expect(requested).toEqual([]);
  });

  it.each([
    [null, ['BTC', 'ETH', 'SOL']],
    ['ETH', ['ETH', 'SOL', 'BTC']],
    ['F', ['SOL', 'BTC', 'ETH']],
    ['ZZZ', ['BTC', 'ETH', 'SOL']],
  ])('starts at the first coin from the cursor %s and wraps', async (cursor, expected) => {
    const { requested } = await stubbedRun({
      held: ['BTC', 'ETH', 'SOL'],
      doneDays: {},
      cursor,
    });

    expect(requested).toEqual([expected]);
  });

  it('stores the first rate-limited coin, in request order, as the next cursor', async () => {
    const { cursor } = await stubbedRun({
      held: ['BTC', 'ETH', 'SOL'],
      doneDays: {},
      cursor: null,
      answer: async () => answered(['SOL', 'ETH']),
    });

    expect(cursor.value).toBe('ETH');
  });

  it('skips a coin that failed for another reason when it picks the cursor', async () => {
    const { cursor } = await stubbedRun({
      held: ['BTC', 'ETH', 'SOL'],
      doneDays: {},
      cursor: null,
      answer: async () => answered(['SOL'], ['BTC']),
    });

    expect(cursor.value).toBe('SOL');
  });

  it('clears the cursor when no coin was rate-limited, even if one failed otherwise', async () => {
    const { cursor } = await stubbedRun({
      held: ['BTC', 'ETH'],
      doneDays: {},
      cursor: 'ETH',
      answer: async () => answered([], ['BTC']),
    });

    expect(cursor.value).toBeNull();
  });

  it('keeps starting at the same coin when the whole crypto leg failed', async () => {
    const { cursor } = await stubbedRun({
      held: ['BTC', 'ETH', 'SOL'],
      doneDays: {},
      cursor: 'ETH',
      answer: async () => {
        throw new Error('CoinGecko history request failed for every coin');
      },
    });

    expect(cursor.value).toBe('ETH');
  });

  it('moves to the first rate-limited coin when the whole crypto leg failed', async () => {
    const { cursor } = await stubbedRun({
      held: ['BTC', 'ETH', 'SOL'],
      doneDays: {},
      cursor: null,
      answer: async () => {
        throw new CryptoHistoryFailure(['SOL', 'ETH']);
      },
    });

    expect(cursor.value).toBe('ETH');
  });

  it('saves the cursor only after the rows are stored', async () => {
    const calls: string[] = [];
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: day(1),
      today: TODAY,
      fetchNbuHistory: async () => ({ entries: usdAnchors, failedCurrencies: [] }),
      fetchCryptoHistory: async () => answered(['BTC']),
      upsertMany: async () => {
        calls.push('rows');
      },
      historyCurrencies: async () => ({ fiatCurrencies: ['USD'], cryptoCurrencies: ['BTC'] }),
      lastBackfilledDayByCurrency: {},
      knownEmptyCurrencies: new Set(),
      readHistoryBackfillCursor: async () => null,
      writeHistoryBackfillCursor: async () => {
        calls.push('cursor');
      },
    };

    await runBackfill(deps);

    expect(calls).toEqual(['rows', 'cursor']);
  });

  it('still completes when the cursor cannot be saved', async () => {
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: null,
      today: TODAY,
      fetchNbuHistory: async () => ({ entries: usdAnchors, failedCurrencies: [] }),
      fetchCryptoHistory: async () => answered(),
      upsertMany: async () => {},
      historyCurrencies: async () => ({ fiatCurrencies: ['USD'], cryptoCurrencies: ['BTC'] }),
      lastBackfilledDayByCurrency: {},
      knownEmptyCurrencies: new Set(),
      readHistoryBackfillCursor: async () => 'BTC',
      writeHistoryBackfillCursor: async () => {
        throw new Error('disk full');
      },
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runBackfill(deps)).resolves.toEqual(
      expect.objectContaining({ state: 'complete' }),
    );
    expect(warn).toHaveBeenCalledWith(
      '[history backfill] cursor not saved',
      expect.objectContaining({ name: 'Error' }),
    );

    warn.mockRestore();
  });

  describe('what a run saves', () => {
    const BTC_FROM_THE_START: CryptoHistory = {
      entries: [0, 1, 2].map((index) => ({
        base: 'BTC',
        quote: 'USD',
        day: day(index),
        rate: 1,
        source: 'coingecko',
      })),
      failedCurrencies: [],
      rateLimitedCurrencies: [],
    };

    it('saves no settled marks when every answer reaches the start of the span', async () => {
      const { settledWrites } = await stubbedRun({
        held: ['BTC'],
        doneDays: {},
        cursor: null,
        lastBackfilledDay: null,
        answer: async () => BTC_FROM_THE_START,
      });

      expect(settledWrites).toEqual([]);
    });

    it('neither reads nor writes the cursor when every held coin is current', async () => {
      const { cursorReads, cursorWrites } = await stubbedRun({
        held: ['BTC', 'ETH'],
        doneDays: { USD: day(1), BTC: TODAY, ETH: TODAY },
        cursor: null,
      });

      expect(cursorReads).toEqual([]);
      expect(cursorWrites).toEqual([]);
    });

    it('does not write the cursor when it would stay the same', async () => {
      const { cursorReads, cursorWrites } = await stubbedRun({
        held: ['BTC'],
        doneDays: {},
        cursor: null,
      });

      expect(cursorReads).toHaveLength(1);
      expect(cursorWrites).toEqual([]);
    });

    it('still completes, and says so, when the settled marks cannot be saved', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      try {
        const { status } = await stubbedRun({
          held: ['BTC'],
          doneDays: {},
          cursor: null,
          lastBackfilledDay: null,
          failSettledWrite: true,
        });

        expect(status).toEqual(expect.objectContaining({ state: 'complete' }));
        expect(warn).toHaveBeenCalledWith(
          '[history backfill] settled marks not saved',
          expect.objectContaining({ name: 'Error' }),
        );
      } finally {
        warn.mockRestore();
      }
    });
  });
});

// A whole backfill against a fake CoinGecko that answers 429 once a run has sent `perRunLimit`
// requests, with the cursor kept between runs and everything else in memory forgotten between
// them, as an app restart forgets it.
type Outcome = 'rows' | 'empty' | 'not-found';

const simulate = (input: {
  held: CryptoCurrency[];
  perRunLimit: number;
  outcomeOf: (code: CryptoCurrency) => Outcome;
}) => {
  const stored: { base: Currency; quote: Currency; day: number }[] = [];
  const answeredCoins = new Set<CryptoCurrency>();
  const cursor: CursorStore = { value: null };
  const codeOfId = new Map(
    (Object.entries(cryptoCoinGeckoId) as [CryptoCurrency, string][]).map(([code, id]) => [
      id,
      code,
    ]),
  );

  const runOnce = async (): Promise<void> => {
    let requestsThisRun = 0;
    const fetchImpl = (async (url: string) => {
      requestsThisRun += 1;

      if (requestsThisRun > input.perRunLimit) {
        return { ok: false, status: 429, json: async () => ({}) };
      }

      const code = codeOfId.get(/coins\/([a-z0-9-]+)\/market_chart/.exec(url)?.[1] ?? '');

      if (code === undefined) {
        throw new Error('the fake CoinGecko was asked for an unknown coin');
      }

      const outcome = input.outcomeOf(code);

      if (outcome === 'not-found') {
        return { ok: false, status: 404, json: async () => ({}) };
      }

      answeredCoins.add(code);
      const prices = outcome === 'rows' ? [day(0), day(1), day(2)].map((d) => [d, 2]) : [];

      return { ok: true, status: 200, json: async () => ({ prices }) };
    }) as unknown as typeof fetch;

    await runBackfill({
      earliestDay: day(0),
      lastBackfilledDay: deriveLastBackfilledDay(stored),
      today: TODAY,
      fetchNbuHistory: async () => ({ entries: usdAnchors, failedCurrencies: [] }),
      fetchCryptoHistory: (days, currencies) => fetchCryptoHistory(days, fetchImpl, currencies),
      upsertMany: async (rows) => {
        stored.push(...rows);
      },
      historyCurrencies: async () => ({ fiatCurrencies: ['USD'], cryptoCurrencies: input.held }),
      lastBackfilledDayByCurrency: deriveLastBackfilledDayByCurrency(stored),
      knownEmptyCurrencies: new Set(),
      readHistoryBackfillCursor: async () => cursor.value,
      writeHistoryBackfillCursor: async (next) => {
        cursor.value = next;
      },
    });
  };

  return { runOnce, stored, answeredCoins, cursor };
};

describe('runBackfill — converging past the CoinGecko burst limit', () => {
  const SEVEN: CryptoCurrency[] = ['ADA', 'BNB', 'BTC', 'ETH', 'SOL', 'USDT', 'XRP'];

  it('gives every one of 7 coins history within 2 runs when a run is cut off after 6 requests', async () => {
    const { runOnce, stored } = simulate({
      held: SEVEN,
      perRunLimit: 6,
      outcomeOf: () => 'rows',
    });

    await runOnce();
    await runOnce();

    for (const coin of SEVEN) {
      expect(stored.some((row) => row.base === coin)).toBe(true);
    }
  });

  it('reaches the 7th coin within 2 runs when 6 coins never gain a row, across a restart', async () => {
    const { runOnce, answeredCoins, cursor } = simulate({
      held: SEVEN,
      perRunLimit: 6,
      outcomeOf: (code) => (code === 'XRP' ? 'rows' : 'empty'),
    });

    await runOnce();

    expect(answeredCoins.has('XRP')).toBe(false);
    expect(cursor.value).toBe('XRP');

    await runOnce();

    expect(answeredCoins.has('XRP')).toBe(true);
  });

  // A coin that fails on its own, every run, is not the burst limit: it must neither become the
  // cursor nor keep the coins behind it waiting.
  it('reaches the 7th coin within 2 runs when the first coin always answers 404', async () => {
    const { runOnce, answeredCoins, cursor } = simulate({
      held: SEVEN,
      perRunLimit: 6,
      outcomeOf: (code) => (code === 'ADA' ? 'not-found' : 'empty'),
    });

    await runOnce();

    expect(answeredCoins.has('XRP')).toBe(false);
    expect(cursor.value).toBe('XRP');

    await runOnce();

    expect(answeredCoins.has('XRP')).toBe(true);
  });

  const pairs = Array.from({ length: 23 }, (_, index) => index + 1).flatMap((coinCount) =>
    Array.from({ length: 8 }, (_, index) => [coinCount, index + 1] as const),
  );

  it.each(pairs)(
    'answers every one of %i held coins within ceil(n / limit) runs at %i requests per run',
    async (coinCount, perRunLimit) => {
      const held = [...CURATED_COIN_CODES].slice(0, coinCount).sort();
      const { runOnce, answeredCoins } = simulate({
        held,
        perRunLimit,
        outcomeOf: (code) => (held.indexOf(code) % 2 === 1 ? 'rows' : 'empty'),
      });

      for (let run = 0; run < Math.ceil(coinCount / perRunLimit); run += 1) {
        await runOnce();
      }

      expect([...answeredCoins].sort()).toEqual(held);
    },
  );

  // The first coin of the order answers 404 on every request but still uses a request of the run.
  it.each(pairs)(
    'answers every other of %i held coins within ceil(n / limit) runs at %i requests per run when one always fails',
    async (coinCount, perRunLimit) => {
      const held = [...CURATED_COIN_CODES].slice(0, coinCount).sort();
      const { runOnce, answeredCoins } = simulate({
        held,
        perRunLimit,
        outcomeOf: (code) => {
          if (code === held[0]) {
            return 'not-found';
          }

          return held.indexOf(code) % 2 === 1 ? 'rows' : 'empty';
        },
      });

      for (let run = 0; run < Math.ceil(coinCount / perRunLimit); run += 1) {
        await runOnce();
      }

      expect([...answeredCoins].sort()).toEqual(held.slice(1).sort());
    },
  );
});
