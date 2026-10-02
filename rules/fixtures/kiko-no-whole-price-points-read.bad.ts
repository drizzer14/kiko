// Semgrep fixture (POSITIVE): kiko-no-whole-price-points-read MUST report a
// finding on every pinned line below. Never "fix" this file — see
// kiko-pricing's "Current price book and whole-table price book".
import { usePriceBook } from '@kiko/prices/use-price-book';
import { database, pricePoints, useLiveQuery } from '@kiko/db';
import { pricePointsRepo } from '@kiko/prices/price-points-repo';

export const useHomeBook = () => {
  // EXPECT-FINDING
  return usePriceBook(true, { cached: true });
};

export const useWholeTable = () =>
  // EXPECT-FINDING
  useLiveQuery(pricePointsRepo.allQuery(), ['price_points']);

export const readEveryPoint = () =>
  // EXPECT-FINDING
  database.select().from(pricePoints);

// The uncalled reference is the same whole-table read, called later.
// EXPECT-FINDING
export const wholeTableQuery = pricePointsRepo.allQuery;

export const relationalEveryPoint = () =>
  // EXPECT-FINDING
  database.query.pricePoints.findMany();
