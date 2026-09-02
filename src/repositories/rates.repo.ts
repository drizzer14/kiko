import { max, sql } from 'drizzle-orm';
import { database, write } from '../db/client';
import { type CurrencyRateRow, currencyRates } from '../db/schema';
import type { Repository } from './repository';

type NewRate = Pick<CurrencyRateRow, 'base' | 'quote' | 'rate' | 'source' | 'fetchedAt'>;

export const ratesRepo = {
  allQuery: () => database.select().from(currencyRates),
  /**
   * The newest `fetchedAt` across all stored rates, or null when none exist.
   * A one-shot read (not reactive) — the caller awaits it to drive the rates
   * refresh throttle.
   */
  latestFetchedAt: async (): Promise<number | null> => {
    const rows = await database.select({ value: max(currencyRates.fetchedAt) }).from(currencyRates);
    return rows.at(0)?.value ?? null;
  },
  upsertMany: (rates: NewRate[]) =>
    write(async (tx) => {
      if (rates.length === 0) {
        return;
      }
      // Upsert on the (base, quote) unique index: a refreshed rate for an
      // existing pair overwrites its value, source, and timestamp in place.
      await tx
        .insert(currencyRates)
        .values(rates)
        .onConflictDoUpdate({
          target: [currencyRates.base, currencyRates.quote],
          set: {
            rate: sql`excluded.rate`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    }),
} satisfies Repository;
