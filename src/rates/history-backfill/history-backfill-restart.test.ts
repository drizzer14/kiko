import { DAY_MS } from '@kiko/dates';
import { minOf } from '@kiko/numbers';
import type { CryptoCurrency, Currency } from '@kiko/currency/currency';

import type { HistoryRateEntry } from '../history-entry';

import {
  type BackfillDeps,
  deriveFirstBackfilledDayByCurrency,
  deriveLastBackfilledDay,
  deriveLastBackfilledDayByCurrency,
  runBackfill,
} from './history-backfill';

const TODAY = Date.UTC(2027, 0, 1);
const daysAgo = (count: number) => TODAY - count * DAY_MS;

type StoredRow = { base: Currency; quote: Currency; day: number; rate: string; source: 'nbu' };

const EIGHT: CryptoCurrency[] = ['ADA', 'BNB', 'BTC', 'DOGE', 'ETH', 'SOL', 'USDT', 'XRP'];

const rowsBetween = (base: Currency, from: number, to: number): StoredRow[] =>
  Array.from({ length: from - to + 1 }, (_, index) => ({
    base,
    quote: 'UAH',
    day: daysAgo(from - index),
    rate: '2',
    source: 'nbu',
  }));

const anchorsFor = (base: Currency, quote: Currency, start: number, end: number) => {
  const entries: HistoryRateEntry[] = [];

  for (let day = start; day <= end; day += DAY_MS) {
    entries.push({ base, quote, day, rate: 2, source: quote === 'UAH' ? 'nbu' : 'coingecko' });
  }

  return entries;
};

const firstStoredDay = (stored: StoredRow[], base: Currency): number =>
  minOf(stored.filter((row) => row.base === base).map((row) => row.day));

// What survives an app restart: the stored rows, the coin cursor and the settled span starts.
type Persisted = {
  stored: StoredRow[];
  cursor: { value: string | null };
  settled: { value: Partial<Record<Currency, number>> };
};

const persisted = (stored: StoredRow[]): Persisted => ({
  stored,
  cursor: { value: null },
  settled: { value: {} },
});

type LaunchInput = {
  data: Persisted;
  held: CryptoCurrency[];
  fiat: Currency[];
  earliestDay: number;
  perRunLimit?: number;
  wholeSpan?: boolean;
  failFiat?: Currency[];
  // The day NBU starts quoting a currency; before it the answer holds nothing.
  nbuStartsAt?: Partial<Record<Currency, number>>;
  requested?: CryptoCurrency[][];
  nbuCalls?: Currency[][];
};

// One launch of the app: everything in memory starts empty and only the persisted data is kept,
// as a restart keeps it. The resume day is the last stored day (today after a run that reached
// it) unless the caller asks for the whole span with `null`.
const launch = async (input: LaunchInput) => {
  const { data } = input;
  const deps: BackfillDeps = {
    earliestDay: input.earliestDay,
    lastBackfilledDay: input.wholeSpan ? null : deriveLastBackfilledDay(data.stored),
    today: TODAY,
    fetchNbuHistory: async (currencies, start, end) => {
      input.nbuCalls?.push(currencies);

      return {
        entries: currencies
          .filter((currency) => !input.failFiat?.includes(currency))
          .flatMap((currency) =>
            anchorsFor(currency, 'UAH', Math.max(start, input.nbuStartsAt?.[currency] ?? 0), end),
          ),
        failedCurrencies: currencies.filter((currency) => input.failFiat?.includes(currency)),
      };
    },
    fetchCryptoHistory: async (count, currencies) => {
      input.requested?.push(currencies);
      const limit = input.perRunLimit ?? currencies.length;
      const limited = currencies.slice(limit);

      return {
        entries: currencies
          .slice(0, limit)
          .flatMap((coin) => anchorsFor(coin, 'USD', daysAgo(count - 1), TODAY)),
        failedCurrencies: limited,
        rateLimitedCurrencies: limited,
      };
    },
    upsertMany: async (rows) => {
      data.stored.push(...(rows as StoredRow[]));
    },
    historyCurrencies: async () => ({ fiatCurrencies: input.fiat, cryptoCurrencies: input.held }),
    lastBackfilledDayByCurrency: deriveLastBackfilledDayByCurrency(data.stored),
    firstBackfilledDayByCurrency: deriveFirstBackfilledDayByCurrency(data.stored),
    knownEmptyCurrencies: new Set(),
    youngCurrencies: new Set(),
    readHistoryBackfillCursor: async () => data.cursor.value,
    writeHistoryBackfillCursor: async (next) => {
      data.cursor.value = next;
    },
    readSettledFiatSpanStarts: async () => data.settled.value,
    writeSettledFiatSpanStarts: async (next) => {
      data.settled.value = next;
    },
  };

  return runBackfill(deps);
};

describe('runBackfill — filling the earlier days of a span that moved earlier, across a restart', () => {
  it('fills the earlier days of the coins a rate-limited run left behind', async () => {
    const data = persisted([
      ...rowsBetween('USD', 100, 0),
      ...EIGHT.flatMap((coin) => rowsBetween(coin, 100, 0)),
    ]);
    const base = {
      data,
      held: EIGHT,
      fiat: ['USD' as Currency],
      earliestDay: daysAgo(300),
      perRunLimit: 6,
    };

    // The span moves to 300 days back while Statistics is mounted: the whole span is asked for,
    // and CoinGecko limits the run after 6 coins.
    await launch({ ...base, wholeSpan: true });

    expect(EIGHT.filter((coin) => firstStoredDay(data.stored, coin) > daysAgo(300))).toEqual([
      'USDT',
      'XRP',
    ]);

    // The app is closed and opened again: the resume day is today and the window is empty.
    const requested: CryptoCurrency[][] = [];
    await launch({ ...base, requested });

    expect(requested).toEqual([['USDT', 'XRP']]);

    for (const coin of EIGHT) {
      expect(firstStoredDay(data.stored, coin)).toBe(daysAgo(300));
    }
  });

  it('fills the earlier days of a fiat currency a failed run left behind', async () => {
    const data = persisted([...rowsBetween('USD', 100, 0), ...rowsBetween('EUR', 100, 0)]);
    const base = { data, held: [], fiat: ['EUR' as Currency, 'USD' as Currency] };

    await launch({ ...base, earliestDay: daysAgo(300), wholeSpan: true, failFiat: ['EUR'] });

    expect(firstStoredDay(data.stored, 'USD')).toBe(daysAgo(300));
    expect(firstStoredDay(data.stored, 'EUR')).toBe(daysAgo(100));

    // The app is closed and opened again, and the provider answers for EUR now.
    await launch({ ...base, earliestDay: daysAgo(300) });

    expect(firstStoredDay(data.stored, 'EUR')).toBe(daysAgo(300));
  });

  // NBU quotes every calendar day, weekends and holidays included, so a span that starts on a
  // Saturday gets a first row on that Saturday and there is nothing left to fetch afterwards.
  it('does not fetch again when the span starts on a weekend', async () => {
    const saturday = Date.UTC(2026, 5, 6);
    const data = persisted([]);
    const base = { data, held: [], fiat: ['EUR' as Currency], earliestDay: saturday };
    const nbuCalls: Currency[][] = [];

    await launch({ ...base, wholeSpan: true, nbuCalls });

    expect(firstStoredDay(data.stored, 'EUR')).toBe(saturday);

    await launch({ ...base, nbuCalls });
    await launch({ ...base, nbuCalls });

    expect(nbuCalls).toEqual([['EUR']]);
  });

  describe('a currency NBU started quoting after the span starts', () => {
    const start = daysAgo(300);
    const quotedFrom = daysAgo(250);

    const lateData = () =>
      persisted([...rowsBetween('USD', 100, 0), ...rowsBetween('EUR', 100, 0)]);

    it('is fetched once over two launches and counts as complete for that span start', async () => {
      const data = lateData();
      const base = {
        data,
        held: [],
        fiat: ['EUR' as Currency, 'USD' as Currency],
        earliestDay: start,
        nbuStartsAt: { EUR: quotedFrom },
      };
      const nbuCalls: Currency[][] = [];

      await launch({ ...base, wholeSpan: true, nbuCalls });

      expect(firstStoredDay(data.stored, 'EUR')).toBe(quotedFrom);
      expect(data.settled.value).toEqual({ EUR: start });

      await launch({ ...base, nbuCalls });
      await launch({ ...base, nbuCalls });

      expect(nbuCalls).toHaveLength(1);
    });

    it('is fetched again when the span starts earlier than the one it settled for', async () => {
      const data = lateData();
      const base = {
        data,
        held: [],
        fiat: ['EUR' as Currency, 'USD' as Currency],
        nbuStartsAt: { EUR: quotedFrom },
      };
      const nbuCalls: Currency[][] = [];

      await launch({ ...base, earliestDay: start, wholeSpan: true, nbuCalls });
      await launch({ ...base, earliestDay: daysAgo(340), nbuCalls });

      expect(nbuCalls).toHaveLength(2);
      expect(data.settled.value).toEqual({ EUR: daysAgo(340) });
    });
  });
});
