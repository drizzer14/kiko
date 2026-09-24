import { eq, sql } from 'drizzle-orm';
import type { Repository } from '@kiko/db/repository';

import { database, write } from '../../db/client';
import { type PricePointRow, pricePoints } from '../../db/schema';

type NewPricePointRow = Pick<PricePointRow, 'instrument' | 'day' | 'price' | 'currency' | 'source'>;

// Mirrors `rateHistoryRepo.upsertMany` (`src/rates/rate-history-repo/`): a
// chunk stays well under SQLite's SQLITE_MAX_VARIABLE_NUMBER (32766) bound
// parameters — 2000 rows/chunk at 5 params/row = 10000 params.
const UPSERT_CHUNK_SIZE = 2000;

export const pricePointsRepo = {
  /** Reactive select of the whole price-points table — hand straight to `useLiveQuery`. */
  allQuery: () => database.select().from(pricePoints),
  upsertMany: (rows: NewPricePointRow[]) =>
    write(async (tx) => {
      // Chunk so a large backfill never exceeds SQLite's bound-variable limit.
      // Upsert on the (instrument, day) unique index: a re-fetched price for an
      // existing instrument-day overwrites its price and source in place.
      for (let start = 0; start < rows.length; start += UPSERT_CHUNK_SIZE) {
        await tx
          .insert(pricePoints)
          .values(rows.slice(start, start + UPSERT_CHUNK_SIZE))
          .onConflictDoUpdate({
            target: [pricePoints.instrument, pricePoints.day],
            set: {
              price: sql`excluded.price`,
              currency: sql`excluded.currency`,
              source: sql`excluded.source`,
            },
          });
      }
    }),
  /** Deletes every stored price point for one instrument, in one transaction. */
  removeInstrument: (instrument: string) =>
    write((tx) => tx.delete(pricePoints).where(eq(pricePoints.instrument, instrument))),
} satisfies Repository;
