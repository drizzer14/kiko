import either from 'fnts/either';
import { DAY_MS } from '@kiko/dates';
import { minOf } from '@kiko/numbers';
import type { SettledHistory } from '@kiko/settings';
import type { CryptoCurrency, Currency } from '@kiko/currency/currency';

import type { HistoryRateEntry } from '../history-entry';

import {
  type BackfillDeps,
  type BackfillStatus,
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

// What survives an app restart: the stored rows, the coin cursor and the settled marks.
type Persisted = {
  stored: StoredRow[];
  cursor: { value: string | null };
  settled: { value: SettledHistory };
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
  today?: number;
  failFiat?: Currency[];
  failUpsert?: boolean;
  // The day NBU starts quoting a currency; before it the answer holds nothing.
  nbuStartsAt?: Partial<Record<Currency, number>>;
  // The day CoinGecko's series of a coin starts.
  coinStartsAt?: Partial<Record<Currency, number>>;
  requested?: CryptoCurrency[][];
  nbuCalls?: Currency[][];
  writes?: SettledHistory[];
};

// One launch of the app: everything in memory starts empty and only the persisted data is kept,
// as a restart keeps it. The resume day is the last stored day (today after a run that reached
// it) unless the caller asks for the whole span with `null`.
const launch = async (input: LaunchInput) => {
  const { data } = input;
  const deps: BackfillDeps = {
    earliestDay: input.earliestDay,
    lastBackfilledDay: input.wholeSpan ? null : deriveLastBackfilledDay(data.stored),
    today: input.today ?? TODAY,
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
          .flatMap((coin) =>
            anchorsFor(
              coin,
              'USD',
              Math.max(daysAgo(count - 1), input.coinStartsAt?.[coin] ?? 0),
              TODAY,
            ),
          ),
        failedCurrencies: limited,
        rateLimitedCurrencies: limited,
      };
    },
    upsertMany: async (rows) => {
      if (input.failUpsert) {
        throw new Error('disk full');
      }

      data.stored.push(...(rows as StoredRow[]));
    },
    historyCurrencies: async () => ({ fiatCurrencies: input.fiat, cryptoCurrencies: input.held }),
    lastBackfilledDayByCurrency: deriveLastBackfilledDayByCurrency(data.stored),
    firstBackfilledDayByCurrency: deriveFirstBackfilledDayByCurrency(data.stored),
    knownEmptyCurrencies: new Set(),
    readHistoryBackfillCursor: async () => data.cursor.value,
    writeHistoryBackfillCursor: async (next) => {
      data.cursor.value = next;
    },
    readSettledHistory: async () => data.settled.value,
    writeSettledHistory: async (additions) => {
      input.writes?.push(additions);
      data.settled.value = { ...data.settled.value, ...additions };
    },
  };

  // A failed upsert rejects the run, as the screen's own catch arm sees it.
  return either<unknown, BackfillStatus>(() => runBackfill(deps));
};

// Successive launches over the same persisted data, each with its own overrides.
const launchAll = async (base: LaunchInput, steps: Partial<LaunchInput>[]): Promise<void> => {
  for (const step of steps) {
    await launch({ ...base, ...step });
  }
};

const fiatBase = (data: Persisted, extra: Partial<LaunchInput> = {}): LaunchInput => ({
  data,
  held: [],
  fiat: ['EUR', 'USD'],
  earliestDay: daysAgo(300),
  ...extra,
});

const coinBase = (data: Persisted, coinStartsAt: LaunchInput['coinStartsAt']): LaunchInput => ({
  data,
  held: ['BTC', 'SOL'],
  fiat: ['USD'],
  earliestDay: daysAgo(300),
  coinStartsAt,
});

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

    const lateBase = (data: Persisted) =>
      fiatBase(data, { earliestDay: start, nbuStartsAt: { EUR: quotedFrom } });

    it('is fetched once over two launches and counts as complete for that span start', async () => {
      const data = lateData();
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...lateBase(data), nbuCalls }, [{ wholeSpan: true }]);

      expect(firstStoredDay(data.stored, 'EUR')).toBe(quotedFrom);
      expect(data.settled.value).toEqual({ EUR: { start, firstDay: quotedFrom } });

      await launchAll({ ...lateBase(data), nbuCalls }, [{}, {}]);

      expect(nbuCalls).toHaveLength(1);
    });

    it('is fetched again when the span starts earlier than the one it settled for', async () => {
      const data = lateData();
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...lateBase(data), nbuCalls }, [
        { wholeSpan: true },
        { earliestDay: daysAgo(340) },
      ]);

      expect(nbuCalls).toHaveLength(2);
      expect(data.settled.value).toEqual({ EUR: { start: daysAgo(340), firstDay: quotedFrom } });
    });

    // The mark is written after the rows: a failed write of the rows must not leave the
    // currency settled with nothing stored.
    it('is fetched again on the next launch when the rows could not be stored', async () => {
      const data = lateData();
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...lateBase(data), nbuCalls }, [{ wholeSpan: true, failUpsert: true }]);

      expect(data.settled.value).toEqual({});

      await launchAll({ ...lateBase(data), nbuCalls }, [{}]);

      expect(nbuCalls).toHaveLength(2);
      expect(firstStoredDay(data.stored, 'EUR')).toBe(quotedFrom);
    });

    it('settles for a span start earlier than the one a first answer settled for', async () => {
      const data = lateData();
      const nbuCalls: Currency[][] = [];

      const earlier = { earliestDay: daysAgo(340), nbuStartsAt: {} };

      await launchAll({ ...lateBase(data), nbuCalls }, [{ wholeSpan: true }, earlier, earlier]);

      expect(nbuCalls).toHaveLength(2);
      expect(data.settled.value).toEqual({
        EUR: { start: daysAgo(340), firstDay: daysAgo(340) },
      });
    });

    it('replaces the first day of its mark when a later whole-span answer starts earlier', async () => {
      const data = lateData();

      await launchAll(lateBase(data), [
        { wholeSpan: true },
        { wholeSpan: true, nbuStartsAt: { EUR: daysAgo(280) } },
      ]);

      expect(data.settled.value).toEqual({ EUR: { start, firstDay: daysAgo(280) } });
    });

    it('keeps its mark when a whole-span answer repeats the first day it settled for', async () => {
      const data = lateData();
      const writes: SettledHistory[] = [];

      await launchAll({ ...lateBase(data), writes }, [{ wholeSpan: true }, { wholeSpan: true }]);

      expect(writes).toHaveLength(1);
    });

    // A restore keeps this device's marks but brings the file's rows, which may start later than
    // the first day the mark remembers.
    it('is fetched again when a restore brought rows that start after its first answered day', async () => {
      const data = lateData();
      data.settled.value = { EUR: { start, firstDay: quotedFrom } };
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...lateBase(data), nbuCalls }, [{}]);

      expect(nbuCalls).toHaveLength(1);
      expect(firstStoredDay(data.stored, 'EUR')).toBe(quotedFrom);
    });
  });

  describe('a currency NBU answers with nothing', () => {
    const eurCalls = (nbuCalls: Currency[][]) =>
      nbuCalls.filter((currencies) => currencies.includes('EUR')).length;

    const emptyBase = (data: Persisted) =>
      fiatBase(data, { nbuStartsAt: { EUR: TODAY + 30 * DAY_MS } });

    const noEurRows = () => persisted([...rowsBetween('USD', 100, 0)]);

    it('is asked once over two launches when it has no rows, and the mark carries the check day', async () => {
      const data = noEurRows();
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...emptyBase(data), nbuCalls }, [{ wholeSpan: true }]);

      expect(data.settled.value).toEqual({
        EUR: { start: daysAgo(300), firstDay: null, checkedOn: TODAY },
      });

      await launchAll({ ...emptyBase(data), nbuCalls }, [{}, {}]);

      expect(eurCalls(nbuCalls)).toBe(1);
    });

    it('is not asked again within 7 days, over two launches', async () => {
      const data = noEurRows();
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...emptyBase(data), nbuCalls }, [
        { wholeSpan: true },
        { today: TODAY + 6 * DAY_MS },
        { today: TODAY + 6 * DAY_MS },
      ]);

      expect(eurCalls(nbuCalls)).toBe(1);
    });

    it('gets its rows on the first launch after 7 days once NBU starts quoting it', async () => {
      const data = noEurRows();
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...emptyBase(data), nbuCalls }, [
        { wholeSpan: true },
        { today: TODAY + 7 * DAY_MS, nbuStartsAt: { EUR: daysAgo(250) } },
      ]);

      expect(eurCalls(nbuCalls)).toBe(2);
      expect(firstStoredDay(data.stored, 'EUR')).toBe(daysAgo(250));
    });

    it('is asked only once more after 7 days when it is still empty, and the mark is re-stamped', async () => {
      const data = noEurRows();
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...emptyBase(data), nbuCalls }, [
        { wholeSpan: true },
        { today: TODAY + 8 * DAY_MS },
        { today: TODAY + 9 * DAY_MS },
      ]);

      expect(eurCalls(nbuCalls)).toBe(2);
      expect(data.settled.value.EUR).toEqual({
        start: daysAgo(300),
        firstDay: null,
        checkedOn: TODAY + 8 * DAY_MS,
      });
    });

    it('is asked again, with its mark restamped, when the span starts earlier than the mark', async () => {
      const data = noEurRows();
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...emptyBase(data), nbuCalls }, [
        { wholeSpan: true },
        { earliestDay: daysAgo(340) },
      ]);

      expect(eurCalls(nbuCalls)).toBe(2);
      expect(data.settled.value.EUR).toEqual({
        start: daysAgo(340),
        firstDay: null,
        checkedOn: TODAY,
      });
    });

    // A mark that names a first day and a check day together is not one the app writes, but a
    // stored one is read as it is: the first day says the currency is not empty.
    it('is asked, and its mark kept, when the mark names both a first day and a check day', async () => {
      const data = noEurRows();
      data.settled.value = {
        EUR: { start: daysAgo(300), firstDay: daysAgo(250), checkedOn: TODAY },
        GBP: undefined,
      };
      const nbuCalls: Currency[][] = [];
      const writes: SettledHistory[] = [];

      await launchAll({ ...emptyBase(data), nbuCalls, writes }, [{}]);

      expect(eurCalls(nbuCalls)).toBe(1);
      expect(writes).toEqual([]);
      expect(data.settled.value.EUR).toEqual({
        start: daysAgo(300),
        firstDay: daysAgo(250),
        checkedOn: TODAY,
      });
    });

    // A check day after today (the clock moved back) would otherwise hold the mark for weeks.
    it('is asked on this launch when its mark is dated in the future', async () => {
      const data = noEurRows();
      data.settled.value = {
        EUR: { start: daysAgo(300), firstDay: null, checkedOn: TODAY + 30 * DAY_MS },
      };
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...emptyBase(data), nbuCalls }, [{}]);

      expect(eurCalls(nbuCalls)).toBe(1);
      expect(data.settled.value.EUR?.checkedOn).toBe(TODAY);
    });

    // An empty answer for a currency that already has rows says nothing about new days.
    it('is still fetched for new days when it has rows', async () => {
      const data = persisted([...rowsBetween('USD', 100, 0), ...rowsBetween('EUR', 100, 0)]);
      const nbuCalls: Currency[][] = [];

      await launchAll({ ...emptyBase(data), nbuCalls }, [{ wholeSpan: true }]);

      expect(data.settled.value).toEqual({});

      await launchAll({ ...emptyBase(data), nbuCalls }, [
        { nbuStartsAt: {}, today: TODAY + DAY_MS },
      ]);

      expect(eurCalls(nbuCalls)).toBe(2);
      expect(
        Math.max(...data.stored.filter((row) => row.base === 'EUR').map((row) => row.day)),
      ).toBe(TODAY + DAY_MS);
    });
  });

  describe('a run that settles nothing', () => {
    // The resume window starts at today, after the span's own start: the answer cannot say the
    // earlier days are empty.
    it('stamps no mark on a fiat currency when the run resumes after the span start', async () => {
      const data = persisted([...rowsBetween('USD', 100, 1), ...rowsBetween('EUR', 100, 1)]);
      const writes: SettledHistory[] = [];

      await launch(fiatBase(data, { earliestDay: daysAgo(100), writes }));

      expect(writes).toEqual([]);
      expect(data.settled.value).toEqual({});
    });

    it('stamps no mark on a coin when the run resumes after the span start', async () => {
      const data = persisted(rowsBetween('SOL', 100, 1));
      const writes: SettledHistory[] = [];

      await launch({ data, held: ['SOL'], fiat: [], earliestDay: daysAgo(100), writes });

      expect(writes).toEqual([]);
      expect(data.settled.value).toEqual({});
    });

    it('stamps no mark on a fiat currency whose own request failed, and asks again', async () => {
      const data = persisted(rowsBetween('USD', 100, 0));
      const nbuCalls: Currency[][] = [];
      const base = fiatBase(data, { nbuCalls });

      await launch({ ...base, wholeSpan: true, failFiat: ['EUR'] });

      expect(data.settled.value).toEqual({});

      nbuCalls.length = 0;
      await launch(base);

      expect(nbuCalls.flat()).toContain('EUR');
    });

    it('stamps no mark on a coin whose own request failed, and asks again', async () => {
      const data = persisted([]);
      const requested: CryptoCurrency[][] = [];
      const base = { data, held: ['BTC', 'SOL'] as CryptoCurrency[], fiat: ['USD' as Currency] };

      await launch({ ...base, earliestDay: daysAgo(300), wholeSpan: true, perRunLimit: 1 });

      expect(data.settled.value).toEqual({});

      await launch({ ...base, earliestDay: daysAgo(300), requested });

      expect(requested).toEqual([['SOL']]);
    });
  });

  // SOL answers with nothing (no rows), or from a day after the span start (rows from 100 days
  // back): either way it costs one whole-span run over two launches, not one per launch.
  describe.each([
    [
      'a coin CoinGecko answers with nothing',
      TODAY + 30 * DAY_MS,
      ['BTC'],
      { firstDay: null, checkedOn: TODAY },
    ],
    [
      'a coin CoinGecko lists after the span starts',
      daysAgo(150),
      ['BTC', 'SOL'],
      { firstDay: daysAgo(150) },
    ],
  ] as const)('%s', (_name, startsAt, withRows, mark) => {
    it('causes one whole-span run over two launches', async () => {
      const data = persisted([
        ...rowsBetween('USD', 100, 0),
        ...withRows.flatMap((coin) => rowsBetween(coin, 100, 0)),
      ]);
      const requested: CryptoCurrency[][] = [];

      await launchAll({ ...coinBase(data, { SOL: startsAt }), requested }, [
        { wholeSpan: true },
        {},
        {},
      ]);

      expect(requested).toEqual([['BTC', 'SOL']]);
      expect(data.settled.value.SOL).toEqual({ start: daysAgo(300), ...mark });
    });
  });
});
