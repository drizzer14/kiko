import {
  type Repository,
  database,
  write,
  type CurrencyRateHistoryRow,
  currencyRateHistory,
} from '@kiko/db';
import { sql } from 'drizzle-orm';
import type { Currency } from '@kiko/currency/currency';

import type { RateTable } from '../conversion';

type NewHistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate' | 'source'>;

// Each row binds 5 parameters (base, quote, day, rate, source). SQLite rejects a
// statement with more than SQLITE_MAX_VARIABLE_NUMBER (32766) bound parameters,
// so a single multi-year backfill (one X:UAH row per priced currency per day →
// tens of thousands of rows over a long span) would overflow one insert and
// store nothing. 2000 rows/chunk = 10000 parameters, a safe margin under the
// ceiling.
const UPSERT_CHUNK_SIZE = 2000;

export const rateHistoryRepo = {
  /** Reactive select of the whole rate-history table — hand straight to `useLiveQuery`. */
  historyRowsQuery: () => database.select().from(currencyRateHistory),
  upsertMany: (rows: NewHistoryRow[]) =>
    write(async (databaseTransaction) => {
      // Chunk so a large first backfill never exceeds SQLite's bound-variable
      // limit. Upsert on the (base, quote, day) unique index: a re-fetched rate
      // for an existing pair-day overwrites its value and source in place.
      for (let start = 0; start < rows.length; start += UPSERT_CHUNK_SIZE) {
        await databaseTransaction
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
 * Build a per-currency `RateTable` (each currency's price in ONE UAH) for
 * `day` from a set of history rows. Only an `X:UAH` star row is read
 * (`quote === 'UAH'`, `base !== 'UAH'`) — a stray cross row is ignored. Each
 * currency resolves to its NEAREST row AT OR BEFORE `day` (carry-forward
 * across gaps — e.g. a Friday rate covers the weekend). A currency with no
 * row at or before `day` is omitted, as is any row whose stored rate text
 * does not parse to a finite number.
 */
export const rateTableAt = (
  rows: Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>[],
  day: number,
): RateTable => {
  const nearest = new Map<Currency, { day: number; rate: string }>();

  for (const row of rows) {
    if (row.day > day || row.quote !== 'UAH' || row.base === 'UAH') {
      continue;
    }
    const current = nearest.get(row.base);

    if (current === undefined || row.day > current.day) {
      nearest.set(row.base, { day: row.day, rate: row.rate });
    }
  }

  const table: RateTable = {};

  for (const [currency, { rate }] of nearest) {
    const parsed = Number(rate);

    if (Number.isFinite(parsed)) {
      table[currency] = parsed;
    }
  }

  return table;
};

/**
 * Build a `RateTable` from each currency's EARLIEST stored row. Used to price
 * buckets that fall before a currency's first history row: `rateTableAt`
 * (nearest AT OR BEFORE) omits such a currency, which would silently drop a
 * foreign holding from the leading buckets and understate the net-worth
 * line's start. Carrying the earliest rate backward keeps that holding
 * valued (flat at the oldest known rate) instead of vanishing. Only an
 * `X:UAH` star row is read, same as `rateTableAt`; non-finite stored rates
 * are skipped too.
 */
export const earliestRateTable = (
  rows: Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>[],
): RateTable => {
  const earliest = new Map<Currency, { day: number; rate: string }>();

  for (const row of rows) {
    if (row.quote !== 'UAH' || row.base === 'UAH') {
      continue;
    }
    const current = earliest.get(row.base);

    if (current === undefined || row.day < current.day) {
      earliest.set(row.base, { day: row.day, rate: row.rate });
    }
  }

  const table: RateTable = {};

  for (const [currency, { rate }] of earliest) {
    const parsed = Number(rate);

    if (Number.isFinite(parsed)) {
      table[currency] = parsed;
    }
  }

  return table;
};
