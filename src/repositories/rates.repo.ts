import { sql } from 'drizzle-orm';
import { database, write } from '../db/client';
import { type CurrencyRateRow, currencyRates } from '../db/schema';

type NewRate = Pick<CurrencyRateRow, 'base' | 'quote' | 'rate' | 'source' | 'fetchedAt'>;

export const ratesRepo = {
  allQuery: () => database.select().from(currencyRates),
  upsertMany: (rates: NewRate[]) =>
    write(async tx => {
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
};
