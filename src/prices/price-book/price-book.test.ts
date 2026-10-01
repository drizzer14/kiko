import type { PricePointRow } from '@kiko/db';
import { withDeviceZoneOffset } from '@kiko/test-support/device-zone-offset';

import { shareInstrument } from '../instrument';

import {
  dayKeyOf,
  priceAt,
  buildPriceBook,
  latestPoint,
  EMPTY_PRICE_BOOK,
  localMidnightOfDayKey,
} from './price-book';

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

    expect(book.points.get(AAPL)?.map((row) => row.day)).toEqual([monday, friday]);
    expect(book.points.get(MSFT)?.map((row) => row.day)).toEqual([monday]);
  });

  it('is empty for no rows', () => {
    const book = buildPriceBook([]);

    expect(book.points.size).toBe(0);
    expect(book.loanPayments.size).toBe(0);
  });

  it('groups linked loan payments by loan id, sorted by time ascending', () => {
    const book = buildPriceBook(
      [],
      [
        { loanHoldingId: 'loan-1', time: friday, amountMinorUnits: -200, currency: 'UAH' },
        { loanHoldingId: 'loan-2', time: monday, amountMinorUnits: -300, currency: 'USD' },
        { loanHoldingId: 'loan-1', time: monday, amountMinorUnits: -100, currency: 'UAH' },
      ],
    );

    expect(book.loanPayments.get('loan-1')).toEqual([
      { loanHoldingId: 'loan-1', time: monday, amountMinorUnits: -100, currency: 'UAH' },
      { loanHoldingId: 'loan-1', time: friday, amountMinorUnits: -200, currency: 'UAH' },
    ]);
    expect(book.loanPayments.get('loan-2')?.map((payment) => payment.time)).toEqual([monday]);
  });

  it('skips a payment row whose loan link is null', () => {
    const book = buildPriceBook(
      [],
      [{ loanHoldingId: null, time: monday, amountMinorUnits: -100, currency: 'UAH' }],
    );

    expect(book.loanPayments.size).toBe(0);
  });
});

describe('EMPTY_PRICE_BOOK', () => {
  it('holds no points and no loan payments', () => {
    expect(EMPTY_PRICE_BOOK.points.size).toBe(0);
    expect(EMPTY_PRICE_BOOK.loanPayments.size).toBe(0);
  });
});

describe('dayKeyOf', () => {
  it('maps a UTC-midnight instant to itself', () => {
    expect(dayKeyOf(monday)).toBe(monday);
  });

  it('reads the LOCAL calendar date, not the UTC one — Kyiv local midnight on a DST day', () => {
    // 2026-03-30 is already Kyiv summer time (DST starts 2026-03-29), so
    // local midnight on 2026-03-30 is 2026-03-29T21:00:00Z — a naive
    // UTC-getter read would misresolve this to the 29th.
    const kyivLocalMidnight = new Date(2026, 2, 30).getTime();

    expect(dayKeyOf(kyivLocalMidnight)).toBe(Date.UTC(2026, 2, 30));
  });
});

describe('localMidnightOfDayKey', () => {
  it('maps a day key to the local midnight of that date', () => {
    expect(localMidnightOfDayKey(Date.UTC(2026, 2, 30))).toBe(new Date(2026, 2, 30).getTime());
  });

  it('keeps the date on a device west of UTC', () => {
    expect(withDeviceZoneOffset(-5, () => localMidnightOfDayKey(Date.UTC(2026, 2, 30)))).toBe(
      Date.UTC(2026, 2, 30, 5),
    );
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
    const dstDay = Date.UTC(2026, 2, 30);
    const dstBook = buildPriceBook([point(AAPL, dstDay, '200.00')]);
    const kyivLocalMidnight = new Date(2026, 2, 30).getTime();

    expect(priceAt(dstBook, AAPL, kyivLocalMidnight)?.price).toBe('200.00');
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
