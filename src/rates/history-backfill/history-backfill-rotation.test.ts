import { DAY_MS } from '@kiko/dates';
import { CURATED_COIN_CODES } from '@kiko/currency/coins';
import type { CryptoCurrency, Currency } from '@kiko/currency/currency';

import { cryptoCoinGeckoId } from '../coingecko-ids';
import type { HistoryRateEntry } from '../history-entry';
import { type CryptoHistory, fetchCryptoHistory } from '../coingecko-history';

import {
  type BackfillDeps,
  deriveLastBackfilledDay,
  deriveLastBackfilledDayByCurrency,
  runBackfill,
} from './history-backfill';

const day = (index: number) => Date.UTC(2026, 8, 1) + index * DAY_MS;
const TODAY = day(2);

const usdAnchors: HistoryRateEntry[] = [0, 1, 2].map((index) => ({
  base: 'USD',
  quote: 'UAH',
  day: day(index),
  rate: 40,
  source: 'nbu',
}));

const answered = (failedCurrencies: CryptoCurrency[] = []): CryptoHistory => ({
  entries: [],
  failedCurrencies,
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
  answer?: (currencies: CryptoCurrency[]) => Promise<CryptoHistory>;
}) => {
  const requested: CryptoCurrency[][] = [];
  const cursor: CursorStore = { value: input.cursor };
  const deps: BackfillDeps = {
    earliestDay: day(0),
    // An explicit null asks for the whole span again, which wants every held coin.
    lastBackfilledDay: input.lastBackfilledDay === undefined ? day(1) : input.lastBackfilledDay,
    today: TODAY,
    fetchNbuHistory: async () => ({ entries: usdAnchors, failedCurrencies: [] }),
    fetchCryptoHistory: async (_days, currencies) => {
      requested.push(currencies);

      return (input.answer ?? (async () => answered()))(currencies);
    },
    upsertMany: async () => {},
    historyCurrencies: async () => ({ fiatCurrencies: ['USD'], cryptoCurrencies: input.held }),
    lastBackfilledDayByCurrency: input.doneDays,
    knownEmptyCurrencies: input.knownEmpty ?? new Set(),
    readHistoryBackfillCursor: async () => cursor.value,
    writeHistoryBackfillCursor: async (next) => {
      cursor.value = next;
    },
  };

  await runBackfill(deps);

  return { requested, cursor };
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

  it('requests every held coin again when the caller asks for the whole span', async () => {
    const { requested } = await stubbedRun({
      held: ['BTC', 'ETH', 'SOL'],
      doneDays: { USD: TODAY, BTC: TODAY, ETH: TODAY, SOL: TODAY },
      cursor: null,
      lastBackfilledDay: null,
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

  it('stores the first coin that failed, in request order, as the next cursor', async () => {
    const { cursor } = await stubbedRun({
      held: ['BTC', 'ETH', 'SOL'],
      doneDays: {},
      cursor: null,
      answer: async () => answered(['SOL', 'ETH']),
    });

    expect(cursor.value).toBe('ETH');
  });

  it('clears the cursor when no coin failed', async () => {
    const { cursor } = await stubbedRun({
      held: ['BTC', 'ETH'],
      doneDays: {},
      cursor: 'ETH',
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

    warn.mockRestore();
  });
});

// A whole backfill against a fake CoinGecko that answers 429 once a run has sent `perRunLimit`
// requests, with the cursor kept between runs and everything else in memory forgotten between
// them, as an app restart forgets it.
const simulate = (input: {
  held: CryptoCurrency[];
  perRunLimit: number;
  gainsRows: (code: CryptoCurrency) => boolean;
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

      answeredCoins.add(code);
      const prices = input.gainsRows(code) ? [day(0), day(1), day(2)].map((d) => [d, 2]) : [];

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
      gainsRows: () => true,
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
      gainsRows: (code) => code === 'XRP',
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
        gainsRows: (code) => held.indexOf(code) % 2 === 1,
      });

      for (let run = 0; run < Math.ceil(coinCount / perRunLimit); run += 1) {
        await runOnce();
      }

      expect([...answeredCoins].sort()).toEqual(held);
    },
  );
});
