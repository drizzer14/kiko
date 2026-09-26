import type { Currency } from '@kiko/currency/currency';

import type { PricePointRow } from '../../db/schema';

/**
 * A transaction linked to a loan (`transactions.loanHoldingId`), with the
 * PAYER holding's currency — the one loan valuation input that lives outside
 * both the holding row and `price_points`.
 */
export type LoanLedgerPayment = {
  loanHoldingId: string | null;
  time: number;
  amountMinorUnits: number;
  currency: Currency;
};

/**
 * Every valuation input a holding row does not carry itself: each stored
 * price point, grouped by `instrument` and sorted day ascending (the shape
 * `priceAt`/`latestPoint` read), and each loan's linked payments, grouped by
 * loan id and sorted time ascending. One book reaches every valuation site,
 * so a loan's payment-based outstanding reads the same on every screen and
 * in every net-worth bucket.
 */
export type PriceBook = {
  points: ReadonlyMap<string, readonly PricePointRow[]>;
  loanPayments: ReadonlyMap<string, readonly LoanLedgerPayment[]>;
};

export const EMPTY_PRICE_BOOK: PriceBook = { points: new Map(), loanPayments: new Map() };

const groupSorted = <Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => string | null,
  orderOf: (row: Row) => number,
): Map<string, Row[]> => {
  const byKey = new Map<string, Row[]>();

  for (const row of rows) {
    const key = keyOf(row);

    if (key === null) {
      continue;
    }

    const existing = byKey.get(key);

    if (existing) {
      existing.push(row);
    } else {
      byKey.set(key, [row]);
    }
  }

  for (const group of byKey.values()) {
    group.sort((first, second) => orderOf(first) - orderOf(second));
  }

  return byKey;
};

/**
 * Groups a flat `price_points` row set, and the linked-loan-payment rows, into
 * a `PriceBook`. A payment row whose link is null is skipped.
 */
export const buildPriceBook = (
  rows: readonly PricePointRow[],
  payments: readonly LoanLedgerPayment[] = [],
): PriceBook => ({
  points: groupSorted(
    rows,
    (row) => row.instrument,
    (row) => row.day,
  ),
  loanPayments: groupSorted(
    payments,
    (payment) => payment.loanHoldingId,
    (payment) => payment.time,
  ),
});

/**
 * Maps an instant to its LOCAL calendar date, normalized to a UTC-midnight
 * epoch value — the same `price_points.day` convention `buildPriceBook`'s
 * rows already carry. Reads the instant through the DEVICE-LOCAL `Date`
 * getters (not the UTC ones), so a net-worth bucket at Kyiv local midnight
 * keys to that Kyiv calendar date even across a DST transition (Review
 * Focus 4).
 */
export const dayKeyOf = (instant: number): number => {
  const date = new Date(instant);

  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
};

/**
 * Resolves `instrument`'s price for `instant`'s local day: the nearest
 * stored point AT OR BEFORE that day (carry-forward across a gap, mirroring
 * `rateTableAt`), falling back to the EARLIEST stored point when every point
 * is later than the requested day (mirroring `earliestRateTable` — see
 * `src/rates/rate-history-repo/rate-history.repo.ts`). Undefined when the
 * instrument has no stored point at all.
 */
export const priceAt = (
  book: PriceBook,
  instrument: string,
  instant: number,
): PricePointRow | undefined => {
  const points = book.points.get(instrument);

  if (points === undefined || points.length === 0) {
    return undefined;
  }

  const day = dayKeyOf(instant);
  const atOrBefore = points.filter((point) => point.day <= day);

  return atOrBefore.length > 0 ? atOrBefore[atOrBefore.length - 1] : points[0];
};

/** The most recent stored price point for `instrument`, or undefined if none. */
export const latestPoint = (book: PriceBook, instrument: string): PricePointRow | undefined => {
  const points = book.points.get(instrument);

  return points === undefined || points.length === 0 ? undefined : points[points.length - 1];
};
