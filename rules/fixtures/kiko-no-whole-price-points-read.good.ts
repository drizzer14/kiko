import { database, holdings, pricePoints } from '@kiko/db';
import { pricePointsRepo } from '@kiko/prices/price-points-repo';
import { useCurrentPriceBook } from '@kiko/prices/use-current-price-book';

// Semgrep fixture (NEGATIVE): `kiko-no-whole-price-points-read` MUST report
// nothing on the current-rows hook and queries, the per-metal bounds query,
// another table's whole select, or a `price_points` select filtered in SQL.
export const useHomeBook = () => useCurrentPriceBook(true, { cached: true });

export const currentRows = (today: number) => pricePointsRepo.currentQuery(today);

export const metalBounds = () => pricePointsRepo.metalDayRangesQuery();

export const everyHolding = () => database.select().from(holdings);

export const firstPoint = () => database.select().from(pricePoints).limit(1);

export const everyHoldingRelational = () => database.query.holdings.findMany();

export const pointsOfDay = (day: number) =>
  database.query.pricePoints.findMany({ where: (point, { eq }) => eq(point.day, day) });
