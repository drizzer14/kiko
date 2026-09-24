import { max, sql } from 'drizzle-orm';
import type { Repository } from '@kiko/db/repository';

import { database, write } from '../../db/client';
import { chunkForTable } from '../../db/chunk-for-table';
import { type CurrencyRateRow, currencyRates } from '../../db/schema';

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
    write(async (transaction) => {
      if (rates.length === 0) {
        return;
      }
      // A full Monobank sync composes every cross pair across the supported
      // currency set (~11,990 rows at 5 params/row), which overflows SQLite's
      // SQLITE_MAX_VARIABLE_NUMBER (32766) in one insert — chunk it the same
      // way `rateHistoryRepo.upsertMany` does, all inside this one transaction.
      for (const chunk of chunkForTable(currencyRates, rates)) {
        // Upsert on the (base, quote) unique index: a refreshed rate for an
        // existing pair overwrites its value, source, and timestamp in place.
        await transaction
          .insert(currencyRates)
          .values(chunk)
          .onConflictDoUpdate({
            target: [currencyRates.base, currencyRates.quote],
            set: {
              rate: sql`excluded.rate`,
              source: sql`excluded.source`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          });
      }
    }),
} satisfies Repository;
