import { sql } from 'drizzle-orm';
import { database, write } from '../db/client';
import { type CurrencyRateHistoryRow, currencyRateHistory } from '../db/schema';
import type { RateTable } from '../rates/conversion';
import type { Repository } from './repository';

type NewHistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate' | 'source'>;

export const rateHistoryRepo = {
  /** Reactive select of the whole rate-history table — hand straight to `useLiveQuery`. */
  historyRowsQuery: () => database.select().from(currencyRateHistory),
  upsertMany: (rows: NewHistoryRow[]) =>
    write(async (tx) => {
      if (rows.length === 0) {
        return;
      }
      // Upsert on the (base, quote, day) unique index: a re-fetched rate for an
      // existing pair-day overwrites its value and source in place.
      await tx
        .insert(currencyRateHistory)
        .values(rows)
        .onConflictDoUpdate({
          target: [currencyRateHistory.base, currencyRateHistory.quote, currencyRateHistory.day],
          set: {
            rate: sql`excluded.rate`,
            source: sql`excluded.source`,
          },
        });
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
