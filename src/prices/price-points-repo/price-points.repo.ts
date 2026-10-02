import { alias } from 'drizzle-orm/sqlite-core';
import { and, eq, gt, like, lte, max, notLike, or, sql } from 'drizzle-orm';
import { type Repository, database, write, type PricePointRow, pricePoints } from '@kiko/db';

import { metalInstrument } from '../instrument';

type NewPricePointRow = Pick<PricePointRow, 'instrument' | 'day' | 'price' | 'currency' | 'source'>;

// One row per instrument matching `instrumentPattern`, holding only its first
// and latest stored day, so a caller that plans from the span never reads the
// series itself.
const dayRangesQuery = (instrumentPattern: string) =>
  database
    .select({
      instrument: pricePoints.instrument,
      firstDay: sql<number>`min(${pricePoints.day})`,
      lastDay: sql<number>`max(${pricePoints.day})`,
    })
    .from(pricePoints)
    .where(like(pricePoints.instrument, instrumentPattern))
    .groupBy(pricePoints.instrument);

// Mirrors `rateHistoryRepo.upsertMany` (`src/rates/rate-history-repo/`): a
// chunk stays well under SQLite's SQLITE_MAX_VARIABLE_NUMBER (32766) bound
// parameters — 2000 rows/chunk at 5 params/row = 10000 params.
const UPSERT_CHUNK_SIZE = 2000;

// The same table under a second name, so a row can be compared with the
// latest row of its own instrument.
const latestPoint = alias(pricePoints, 'latest_point');

export const pricePointsRepo = {
  /**
   * Reactive select of the whole price-points table — the one read of a
   * screen that values the past (statistics), so it grows with the daily
   * metal closes. A screen that values only `today` or later reads
   * `currentQuery`.
   */
  allQuery: () => database.select().from(pricePoints),
  /**
   * Every row a valuation on `today` or any later day reads. A metal series
   * keeps its latest point on or before `today` (what `priceAt` picks) plus
   * every point after it, which a later day, or the earliest-point fallback
   * of a series that starts after `today`, still needs. A directly priced
   * holding keeps its whole series: a loan counts its schedule down from the
   * correction before a past payment day.
   */
  currentQuery: (today: number) =>
    database
      .select()
      .from(pricePoints)
      .where(
        or(
          notLike(pricePoints.instrument, metalInstrument('%')),
          gt(pricePoints.day, today),
          eq(
            pricePoints.day,
            database
              .select({ day: max(latestPoint.day) })
              .from(latestPoint)
              .where(
                and(
                  eq(latestPoint.instrument, pricePoints.instrument),
                  lte(latestPoint.day, today),
                ),
              ),
          ),
        ),
      ),
  /** The first and latest stored day of each metal series: one row per metal, not its whole history. */
  metalDayRangesQuery: () => dayRangesQuery(metalInstrument('%')),
  upsertMany: (rows: NewPricePointRow[]) =>
    write(async (databaseTransaction) => {
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
    }),
  /** Deletes every stored price point for one instrument, in one transaction. */
  removeInstrument: (instrument: string) =>
    write((databaseTransaction) =>
      databaseTransaction.delete(pricePoints).where(eq(pricePoints.instrument, instrument)),
    ),
} satisfies Repository;
