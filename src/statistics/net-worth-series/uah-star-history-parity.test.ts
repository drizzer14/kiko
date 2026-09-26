import { runBackfill } from '@kiko/rates/history-backfill';

import { Money, toMajor } from '../../currency/money';
import type { Currency } from '../../currency/currency';
import type { SeriesHolding } from '../holding-value-at';
import { toUtcMidnight } from '../../rates/history-entry';
import type { CurrencyRateHistoryRow } from '../../db/schema';

import { buildNetWorthSeries } from './net-worth-series';

// This is a parity pin: it must pass unedited both before and after a
// stored-cross-pair history table is replaced by a read-time UAH pivot. It
// exercises the real `runBackfill` -> `buildNetWorthSeries` path end to end,
// so a future rewrite of how history rows are composed is proven not to move
// a single already-converting bucket's value. Every expected amount is
// computed HERE, from the fixture's own raw daily UAH-anchored prices, never
// read back from a history row the production code wrote.
const DAY_MS = 24 * 60 * 60 * 1000;
const D0 = Date.UTC(2026, 0, 1);
const SPAN_DAYS = 10; // day indices 0..9, D0 is day 0

const dayAt = (index: number): number => D0 + index * DAY_MS;

// A distinct daily rate per anchor so no bucket's value collapses onto
// another's by coincidence.
const usdAtDay = (index: number): number => 41 + index * 0.1;
const eurAtDay = (index: number): number => 45 + index * 0.1;
const btcUsdAtDay = (index: number): number => 60_000 + index * 100;

/** Each currency's price in ONE UAH on day `index`, from the raw fixture facts. */
const uahPer = (index: number, currency: Currency): number => {
  if (currency === 'UAH') {
    return 1;
  }
  if (currency === 'USD') {
    return usdAtDay(index);
  }
  if (currency === 'EUR') {
    return eurAtDay(index);
  }
  if (currency === 'BTC') {
    return btcUsdAtDay(index) * usdAtDay(index);
  }
  throw new Error(`fixture has no UAH price for ${currency}`);
};

// A bucket before day 0 carries day 0's rate backward (`earliestRateTable`);
// a bucket at or after the last stored day stays clamped to it (no bucket in
// this fixture's own range goes past day 9).
const dayIndexFor = (t: number): number => {
  const raw = Math.round((toUtcMidnight(t) - D0) / DAY_MS);
  return Math.min(Math.max(raw, 0), SPAN_DAYS - 1);
};

const fetchNbuHistory = async (start: number, end: number) => {
  const rows: { base: Currency; quote: Currency; day: number; rate: number; source: 'nbu' }[] = [];
  for (let index = 0; index < SPAN_DAYS; index += 1) {
    const day = dayAt(index);
    if (day < start || day > end) {
      continue;
    }
    rows.push({ base: 'USD', quote: 'UAH', day, rate: usdAtDay(index), source: 'nbu' });
    rows.push({ base: 'EUR', quote: 'UAH', day, rate: eurAtDay(index), source: 'nbu' });
  }
  return rows;
};

const fetchCryptoHistory = async () => {
  const rows: {
    base: Currency;
    quote: Currency;
    day: number;
    rate: number;
    source: 'coingecko';
  }[] = [];
  for (let index = 0; index < SPAN_DAYS; index += 1) {
    rows.push({
      base: 'BTC',
      quote: 'USD',
      day: dayAt(index),
      rate: btcUsdAtDay(index),
      source: 'coingecko',
    });
  }
  return rows;
};

type HistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>;

/** Runs the real `runBackfill` over the whole span and returns its composed rows. */
const buildHistoryRows = async (): Promise<HistoryRow[]> => {
  const captured: HistoryRow[] = [];

  const status = await runBackfill({
    earliestDay: D0,
    lastBackfilledDay: null,
    today: dayAt(SPAN_DAYS - 1),
    fetchNbuHistory,
    fetchCryptoHistory,
    upsertMany: async (rows) => {
      captured.push(...rows);
    },
    openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: ['BTC'] }),
  });

  if (status.state !== 'complete') {
    throw new Error(`expected a complete backfill, got ${status.state}`);
  }
  return captured;
};

const holding = (over: Partial<SeriesHolding> & Pick<SeriesHolding, 'id'>): SeriesHolding => ({
  currency: 'USD',
  type: 'cash',
  balanceMinorUnits: 0,
  metadata: null,
  ...over,
});

const uahCard = holding({ id: 'uah-card', currency: 'UAH', balanceMinorUnits: 400_000 }); // 4000.00 UAH
const usdCard = holding({ id: 'usd-card', currency: 'USD', balanceMinorUnits: 10_000 }); // 100.00 USD
const btcWallet = holding({
  id: 'btc-wallet',
  currency: 'BTC',
  type: 'crypto_asset',
  balanceMinorUnits: 100_000_000, // 1 BTC
});
const holdings = [uahCard, usdCard, btcWallet];

const expectedConvertedMinor = (money: Money, base: Currency, dayIndex: number): number =>
  money.currency === base
    ? money.minorUnits
    : Money.fromMajor(
        base,
        toMajor(money.minorUnits, money.currency) *
          (uahPer(dayIndex, money.currency) / uahPer(dayIndex, base)),
      ).minorUnits;

const expectedAmountAt = (t: number, base: Currency): number => {
  const dayIndex = dayIndexFor(t);
  const totalMinor = holdings.reduce(
    (sum, seriesHolding) =>
      sum +
      expectedConvertedMinor(
        Money.of(seriesHolding.currency, seriesHolding.balanceMinorUnits),
        base,
        dayIndex,
      ),
    0,
  );
  return toMajor(totalMinor, base);
};

describe('buildNetWorthSeries over real runBackfill rows — history parity pins', () => {
  it.each(['USD', 'EUR'] as Currency[])(
    'base %s: pins every daily bucket, including the carry-back bucket before the first history day',
    async (base) => {
      const historyRows = await buildHistoryRows();
      const range = { from: dayAt(-1), to: dayAt(SPAN_DAYS - 1) };

      const series = buildNetWorthSeries({
        holdings,
        transactionsByHolding: new Map(),
        historyRows,
        baseCurrency: base,
        range,
      });

      const expectedTimes = [
        dayAt(-1),
        ...Array.from({ length: SPAN_DAYS }, (_, index) => dayAt(index)),
      ];
      const expectedPoints = expectedTimes.map((t) => ({ t, amount: expectedAmountAt(t, base) }));

      expect(series.points).toEqual(expectedPoints);
      expect(series.startReference).toBe(expectedPoints[0].amount);
    },
  );
});
