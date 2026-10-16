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

// One launch of the app: everything in memory starts empty and only the stored rows and the
// cursor are kept, as a restart keeps them. The resume day is the last stored day (today after a
// run that reached it) unless the caller asks for the whole span with `null`.
const launch = async (input: {
  stored: StoredRow[];
  cursor: { value: string | null };
  held: CryptoCurrency[];
  fiat: Currency[];
  earliestDay: number;
  perRunLimit: number;
  wholeSpan?: boolean;
  requested?: CryptoCurrency[][];
}) => {
  const deps: BackfillDeps = {
    earliestDay: input.earliestDay,
    lastBackfilledDay: input.wholeSpan ? null : deriveLastBackfilledDay(input.stored),
    today: TODAY,
    fetchNbuHistory: async (currencies, start, end) => ({
      entries: currencies.flatMap((currency) => anchorsFor(currency, 'UAH', start, end)),
      failedCurrencies: [],
    }),
    fetchCryptoHistory: async (count, currencies) => {
      input.requested?.push(currencies);
      const answered = currencies.slice(0, input.perRunLimit);
      const limited = currencies.slice(input.perRunLimit);

      return {
        entries: answered.flatMap((coin) => anchorsFor(coin, 'USD', daysAgo(count - 1), TODAY)),
        failedCurrencies: limited,
        rateLimitedCurrencies: limited,
      };
    },
    upsertMany: async (rows) => {
      input.stored.push(...(rows as StoredRow[]));
    },
    historyCurrencies: async () => ({ fiatCurrencies: input.fiat, cryptoCurrencies: input.held }),
    lastBackfilledDayByCurrency: deriveLastBackfilledDayByCurrency(input.stored),
    firstBackfilledDayByCurrency: deriveFirstBackfilledDayByCurrency(input.stored),
    knownEmptyCurrencies: new Set(),
    youngCurrencies: new Set(),
    readHistoryBackfillCursor: async () => input.cursor.value,
    writeHistoryBackfillCursor: async (next) => {
      input.cursor.value = next;
    },
  };

  return runBackfill(deps);
};

describe('runBackfill — filling the earlier days of a span that moved earlier, across a restart', () => {
  it('fills the earlier days of the coins a rate-limited run left behind', async () => {
    const stored: StoredRow[] = [
      ...rowsBetween('USD', 100, 0),
      ...EIGHT.flatMap((coin) => rowsBetween(coin, 100, 0)),
    ];
    const base = {
      stored,
      cursor: { value: null as string | null },
      held: EIGHT,
      fiat: ['USD' as Currency],
      earliestDay: daysAgo(300),
      perRunLimit: 6,
    };

    // The span moves to 300 days back while Statistics is mounted: the whole span is asked for,
    // and CoinGecko limits the run after 6 coins.
    await launch({ ...base, wholeSpan: true });

    expect(EIGHT.filter((coin) => firstStoredDay(stored, coin) > daysAgo(300))).toEqual([
      'USDT',
      'XRP',
    ]);

    // The app is closed and opened again: the resume day is today and the window is empty.
    const requested: CryptoCurrency[][] = [];
    await launch({ ...base, requested });

    expect(requested).toEqual([['USDT', 'XRP']]);

    for (const coin of EIGHT) {
      expect(firstStoredDay(stored, coin)).toBe(daysAgo(300));
    }
  });
});
