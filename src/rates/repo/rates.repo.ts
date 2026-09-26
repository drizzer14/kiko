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
  /**
   * Distinct currencies with at least one stored row — a cheap presence
   * check, never the full cross table. `buildUahRows` writes one row per
   * priced currency, always as `base` (a star row's `quote` is always `UAH`,
   * so `UAH` itself never appears here — the caller must treat `UAH` as
   * always present, see `shouldThrottle`, `rates-refresh.ts`). A one-shot
   * read (not reactive) — `refreshRates`'s own throttle-skip check awaits it.
   */
  presentCurrenciesQuery: () =>
    database.selectDistinct({ currency: currencyRates.base }).from(currencyRates),
  upsertMany: (rates: NewRate[]) =>
    write(async (databaseTransaction) => {
      if (rates.length === 0) {
        return;
      }
      // A full Monobank sync now writes only ~109 rows (one X:UAH row per
      // priced currency, not the ~11,990-row cross join a legacy write once
      // composed) — well under SQLite's SQLITE_MAX_VARIABLE_NUMBER (32766),
      // but a `.kiko` restore can still write a much larger legacy-shaped
      // batch, so this chunking stays, the same way `rateHistoryRepo.upsertMany` does.
      for (const chunk of chunkForTable(currencyRates, rates)) {
        // Upsert on the (base, quote) unique index: a refreshed rate for an
        // existing pair overwrites its value, source, and timestamp in place.
        await databaseTransaction
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
