import type { PricePointRow } from '../../db/schema';

/**
 * Every stored price point, grouped by `instrument` and sorted day ascending
 * within each group — the shape `priceAt`/`latestPoint` read.
 */
export type PriceBook = ReadonlyMap<string, readonly PricePointRow[]>;

export const EMPTY_PRICE_BOOK: PriceBook = new Map();

/** Groups a flat `price_points` row set into a `PriceBook`. */
export const buildPriceBook = (rows: readonly PricePointRow[]): PriceBook => {
  const byInstrument = new Map<string, PricePointRow[]>();

  for (const row of rows) {
    const existing = byInstrument.get(row.instrument);

    if (existing) {
      existing.push(row);
    } else {
      byInstrument.set(row.instrument, [row]);
    }
  }

  for (const points of byInstrument.values()) {
    points.sort((a, b) => a.day - b.day);
  }

  return byInstrument;
};

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
  const points = book.get(instrument);

  if (points === undefined || points.length === 0) {
    return undefined;
  }

  const day = dayKeyOf(instant);
  const atOrBefore = points.filter((point) => point.day <= day);

  return atOrBefore.length > 0 ? atOrBefore[atOrBefore.length - 1] : points[0];
};

/** The most recent stored price point for `instrument`, or undefined if none. */
export const latestPoint = (book: PriceBook, instrument: string): PricePointRow | undefined => {
  const points = book.get(instrument);

  return points === undefined || points.length === 0 ? undefined : points[points.length - 1];
};
