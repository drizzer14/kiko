import { DAY_MS } from '@kiko/dates';
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

const monday = Date.UTC(2026, 8, 7); // 2026-09-07, a Monday, UTC midnight
const tuesday = monday + DAY_MS;
const friday = monday + 4 * DAY_MS;

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
    const before = monday - DAY_MS;

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

describe('priceAt against the filter it replaced', () => {
  const filterPriceAt = (
    book: ReturnType<typeof buildPriceBook>,
    instrument: string,
    instant: number,
  ): PricePointRow | undefined => {
    const points = book.points.get(instrument);

    if (points === undefined || points.length === 0) {
      return undefined;
    }

    const day = dayKeyOf(instant);
    const atOrBefore = points.filter((candidate) => candidate.day <= day);

    return atOrBefore.length > 0 ? atOrBefore[atOrBefore.length - 1] : points[0];
  };

  // A weekday-only share series with a gap, a gap-free metal series, a
  // single-point instrument, and a same-day pair, so every branch is hit.
  const rows: PricePointRow[] = [];

  for (let offset = 0; offset < 200; offset += 1) {
    const day = monday + offset * DAY_MS;
    const weekday = new Date(day).getUTCDay();

    if (weekday !== 0 && weekday !== 6 && (offset < 60 || offset > 80)) {
      rows.push(point(AAPL, day, `${100 + offset}.00`));
    }

    rows.push(point('metal:gold', day, `${2000 + offset}.00`));
  }
  rows.push(point(MSFT, monday + 50 * DAY_MS, '410.00'));
  rows.push(point('share:TWIN', monday + 10 * DAY_MS, '1.00'));
  rows.push(point('share:TWIN', monday + 10 * DAY_MS, '2.00'));
  rows.push(point('share:TWIN', monday + 20 * DAY_MS, '3.00'));

  const book = buildPriceBook(rows);
  const instruments = [AAPL, MSFT, 'metal:gold', 'share:TWIN', 'share:NOPE'];

  it('returns the same point for every instrument on every day, before, inside and after the series', () => {
    for (const instrument of instruments) {
      for (let offset = -5; offset < 215; offset += 1) {
        expect(priceAt(book, instrument, monday + offset * DAY_MS)).toBe(
          filterPriceAt(book, instrument, monday + offset * DAY_MS),
        );
      }
    }
  });

  it('returns the same point for an instant inside a day, not only at its midnight', () => {
    for (let offset = 0; offset < 100; offset += 1) {
      const instant = monday + offset * DAY_MS + 13 * 3_600_000 + 7;

      expect(priceAt(book, AAPL, instant)).toBe(filterPriceAt(book, AAPL, instant));
    }
  });

  it('returns the same point across the Kyiv DST days', () => {
    const dstBook = buildPriceBook(
      [28, 29, 30, 31].map((date) => point(AAPL, Date.UTC(2026, 2, date), `${date}.00`)),
    );

    for (const [month, date, hours] of [
      [2, 28, 23],
      [2, 29, 0],
      [2, 29, 12],
      [2, 30, 0],
      [2, 30, 23],
      [2, 31, 0],
    ]) {
      const instant = new Date(2026, month, date, hours).getTime();

      expect(priceAt(dstBook, AAPL, instant)).toBe(filterPriceAt(dstBook, AAPL, instant));
    }
  });

  it('keeps the last of two same-day points, as the filter did', () => {
    expect(priceAt(book, 'share:TWIN', monday + 10 * DAY_MS)?.price).toBe('2.00');
    expect(priceAt(book, 'share:TWIN', monday + 15 * DAY_MS)?.price).toBe('2.00');
  });

  it('reads a logarithmic number of points per lookup, not the whole series', () => {
    let reads = 0;
    const counted = Array.from({ length: 756 }, (_, offset) => {
      const row = point(AAPL, monday + offset * DAY_MS, '1.00');

      return Object.defineProperty({ ...row }, 'day', {
        get: () => {
          reads += 1;

          return row.day;
        },
        enumerable: true,
      });
    });
    const countedBook = {
      ...EMPTY_PRICE_BOOK,
      points: new Map([[AAPL, counted]]),
    };

    priceAt(countedBook, AAPL, monday + 400 * DAY_MS);

    expect(reads).toBeLessThanOrEqual(12);
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
