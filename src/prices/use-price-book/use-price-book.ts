import { useMemo } from 'react';

import { useLiveQuery } from '../../db/use-live-query';
import { pricePointsRepo } from '../price-points-repo';
import { buildPriceBook, type PriceBook } from '../price-book';

/**
 * Reactive `PriceBook`, subscribed to the whole `price_points` table. Rebuilt
 * only when the live row set itself changes — `useMemo` keyed on `rows`, so a
 * re-render that touches unrelated state does not re-group every point.
 */
export const usePriceBook = (): PriceBook => {
  const { data: rows } = useLiveQuery(pricePointsRepo.allQuery(), ['price_points']);

  return useMemo(() => buildPriceBook(rows), [rows]);
};
