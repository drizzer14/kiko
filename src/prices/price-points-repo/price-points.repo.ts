import { eq, like, sql } from 'drizzle-orm';
import { type Repository, database, write, type PricePointRow, pricePoints } from '@kiko/db';

import { shareInstrument } from '../instrument';

type NewPricePointRow = Pick<PricePointRow, 'instrument' | 'day' | 'price' | 'currency' | 'source'>;

// Mirrors `rateHistoryRepo.upsertMany` (`src/rates/rate-history-repo/`): a
// chunk stays well under SQLite's SQLITE_MAX_VARIABLE_NUMBER (32766) bound
// parameters — 2000 rows/chunk at 5 params/row = 10000 params.
const UPSERT_CHUNK_SIZE = 2000;

/**
 * Runs inside the caller's own `write()`, so a refresh can commit its prices
 * together with the state that paid for them.
 */
export const upsertPricePointsDatabaseTransaction = async (
  databaseTransaction: typeof database,
  rows: NewPricePointRow[],
): Promise<void> => {
  // Chunk so a large backfill never exceeds SQLite's bound-variable limit.
  // Upsert on the (instrument, day) unique index: a re-fetched price for an
  // existing instrument-day overwrites its price and source in place.
  for (let start = 0; start < rows.length; start += UPSERT_CHUNK_SIZE) {
    await databaseTransaction
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
};

export const pricePointsRepo = {
  /** Reactive select of the whole price-points table — hand straight to `useLiveQuery`. */
  allQuery: () => database.select().from(pricePoints),
  /** The latest stored day of each share series: one row per share, not its whole history. */
  latestShareDaysQuery: () =>
    database
      .select({ instrument: pricePoints.instrument, day: sql<number>`max(${pricePoints.day})` })
      .from(pricePoints)
      .where(like(pricePoints.instrument, shareInstrument('%')))
      .groupBy(pricePoints.instrument),
  upsertMany: (rows: NewPricePointRow[]) =>
    write((databaseTransaction) => upsertPricePointsDatabaseTransaction(databaseTransaction, rows)),
  /** Deletes every stored price point for one instrument, in one transaction. */
  removeInstrument: (instrument: string) =>
    write((databaseTransaction) =>
      databaseTransaction.delete(pricePoints).where(eq(pricePoints.instrument, instrument)),
    ),
} satisfies Repository;
