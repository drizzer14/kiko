import type { Repository } from '@kiko/db/repository';
import { sql } from 'drizzle-orm';

import { database, write } from '../../db/client';
import { type CurrencyRateHistoryRow, currencyRateHistory } from '../../db/schema';
import type { RateTable } from '../conversion';

type NewHistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate' | 'source'>;

// Each row binds 5 parameters (base, quote, day, rate, source). SQLite rejects a
// statement with more than SQLITE_MAX_VARIABLE_NUMBER (32766) bound parameters,
// so a single multi-year backfill (12 cross pairs/day → tens of thousands of
// rows) would overflow one insert and store nothing. 2000 rows/chunk = 10000
// parameters, a safe margin under the ceiling.
const UPSERT_CHUNK_SIZE = 2000;

export const rateHistoryRepo = {
  /** Reactive select of the whole rate-history table — hand straight to `useLiveQuery`. */
  historyRowsQuery: () => database.select().from(currencyRateHistory),
  upsertMany: (rows: NewHistoryRow[]) =>
    write(async (tx) => {
      // Chunk so a large first backfill never exceeds SQLite's bound-variable
      // limit. Upsert on the (base, quote, day) unique index: a re-fetched rate
      // for an existing pair-day overwrites its value and source in place.
      for (let start = 0; start < rows.length; start += UPSERT_CHUNK_SIZE) {
        await tx
          .insert(currencyRateHistory)
          .values(rows.slice(start, start + UPSERT_CHUNK_SIZE))
          .onConflictDoUpdate({
            target: [currencyRateHistory.base, currencyRateHistory.quote, currencyRateHistory.day],
            set: {
              rate: sql`excluded.rate`,
              source: sql`excluded.source`,
            },
          });
      }
    }),
} satisfies Repository;

/**
 * Build a flat `RateTable` ("BASE:QUOTE" -> numeric rate) for `day` from a set
 * of history rows. Each pair resolves to its NEAREST row AT OR BEFORE `day`
 * (carry-forward across gaps — e.g. a Friday rate covers the weekend). A pair
 * with no row at or before `day` is omitted, as is any row whose stored rate
 * text does not parse to a finite number.
 */
export const rateTableAt = (
  rows: Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>[],
  day: number,
): RateTable => {
  const nearest = new Map<string, { day: number; rate: string }>();
  for (const row of rows) {
    if (row.day > day) {
      continue;
    }
    const key = `${row.base}:${row.quote}`;
    const current = nearest.get(key);
    if (current === undefined || row.day > current.day) {
      nearest.set(key, { day: row.day, rate: row.rate });
    }
  }

  const table: RateTable = {};
  for (const [key, { rate }] of nearest) {
    const parsed = Number(rate);
    if (Number.isFinite(parsed)) {
      table[key] = parsed;
    }
  }
  return table;
};

/**
 * Build a `RateTable` from each pair's EARLIEST stored row. Used to price buckets
 * that fall before a pair's first history row: `rateTableAt` (nearest AT OR
 * BEFORE) omits such pairs, which would silently drop foreign holdings from the
 * leading buckets and understate the net-worth line's start. Carrying the
 * earliest rate backward keeps those holdings valued (flat at the oldest known
 * rate) instead of vanishing. Non-finite stored rates are skipped, as in
 * `rateTableAt`.
 */
export const earliestRateTable = (
  rows: Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>[],
): RateTable => {
  const earliest = new Map<string, { day: number; rate: string }>();
  for (const row of rows) {
    const key = `${row.base}:${row.quote}`;
    const current = earliest.get(key);
    if (current === undefined || row.day < current.day) {
      earliest.set(key, { day: row.day, rate: row.rate });
    }
  }

  const table: RateTable = {};
  for (const [key, { rate }] of earliest) {
    const parsed = Number(rate);
    if (Number.isFinite(parsed)) {
      table[key] = parsed;
    }
  }
  return table;
};
