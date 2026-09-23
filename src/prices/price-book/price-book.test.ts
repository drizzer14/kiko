import { shareInstrument } from '../instrument';
import type { PricePointRow } from '../../db/schema';

import { dayKeyOf, priceAt, buildPriceBook, latestPoint, EMPTY_PRICE_BOOK } from './price-book';

const DAY = 24 * 60 * 60 * 1000;
const monday = Date.UTC(2026, 8, 7); // 2026-09-07, a Monday, UTC midnight
const tuesday = monday + DAY;
const friday = monday + 4 * DAY;

const AAPL = shareInstrument('AAPL');
const MSFT = shareInstrument('MSFT');

const point = (instrument: string, day: number, price: string): PricePointRow => ({
  instrument,
  day,
  price,
  currency: 'USD',
  source: 'eodhd',
});

describe('buildPriceBook', () => {
  it('groups rows by instrument, sorted by day ascending', () => {
    const book = buildPriceBook([
      point(AAPL, friday, '191'),
      point(AAPL, monday, '190'),
      point(MSFT, monday, '410'),
    ]);

    expect(book.get(AAPL)?.map((row) => row.day)).toEqual([monday, friday]);
    expect(book.get(MSFT)?.map((row) => row.day)).toEqual([monday]);
  });

  it('is empty for no rows', () => {
    expect(buildPriceBook([]).size).toBe(0);
  });
});

describe('EMPTY_PRICE_BOOK', () => {
  it('is an empty map', () => {
    expect(EMPTY_PRICE_BOOK.size).toBe(0);
  });
});

describe('dayKeyOf', () => {
  it('maps a UTC-midnight instant to itself', () => {
    expect(dayKeyOf(monday)).toBe(monday);
  });

  it('reads the LOCAL calendar date, not the UTC one — Kyiv local midnight on a DST day', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'Europe/Kyiv';

    try {
      // 2026-03-30 is already Kyiv summer time (DST starts 2026-03-29), so
      // local midnight on 2026-03-30 is 2026-03-29T21:00:00Z — a naive
      // UTC-getter read would misresolve this to the 29th.
      const kyivLocalMidnight = new Date(2026, 2, 30).getTime();

      expect(dayKeyOf(kyivLocalMidnight)).toBe(Date.UTC(2026, 2, 30));
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

describe('priceAt', () => {
  const book = buildPriceBook([point(AAPL, monday, '190.00'), point(AAPL, friday, '195.00')]);

  it('resolves the exact-day point when one exists', () => {
    expect(priceAt(book, AAPL, monday)?.price).toBe('190.00');
  });

  it('carries the nearest prior point forward across a gap', () => {
    expect(priceAt(book, AAPL, tuesday)?.price).toBe('190.00');
  });

  it('falls back to the earliest point for an instant before the first row', () => {
    const before = monday - DAY;

    expect(priceAt(book, AAPL, before)?.price).toBe('190.00');
  });

  it('returns undefined for an instrument with no stored points', () => {
    expect(priceAt(book, shareInstrument('UNKNOWN'), monday)).toBeUndefined();
  });

  it('resolves a Kyiv local-midnight DST instant to its own local-day point', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'Europe/Kyiv';

    try {
      const dstDay = Date.UTC(2026, 2, 30);
      const dstBook = buildPriceBook([point(AAPL, dstDay, '200.00')]);
      const kyivLocalMidnight = new Date(2026, 2, 30).getTime();

      expect(priceAt(dstBook, AAPL, kyivLocalMidnight)?.price).toBe('200.00');
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

describe('latestPoint', () => {
  it('returns the most recent point for an instrument', () => {
    const book = buildPriceBook([point(AAPL, monday, '190.00'), point(AAPL, friday, '195.00')]);

    expect(latestPoint(book, AAPL)?.price).toBe('195.00');
  });

  it('returns undefined for an instrument with no stored points', () => {
    expect(latestPoint(EMPTY_PRICE_BOOK, AAPL)).toBeUndefined();
  });
});
