import { useMemo } from 'react';

import { useLiveQuery } from '../../db/use-live-query';
import { pricePointsRepo } from '../price-points-repo';
import { buildPriceBook, type PriceBook } from '../price-book';

type UsePriceBookResult = { book: PriceBook; isLoading: boolean };

/**
 * Reactive `PriceBook`, subscribed to the whole `price_points` table. Rebuilt
 * only when the live row set itself changes — `useMemo` keyed on `rows`, so a
 * re-render that touches unrelated state does not re-group every point.
 * `isLoading` threads straight through from the underlying `useLiveQuery`
 * (first-load only), so a screen can gate its own empty state on it — see
 * `kiko-architecture`'s useLiveQuery consumer rule.
 */
export const usePriceBook = (): UsePriceBookResult => {
  const { data: rows, isLoading } = useLiveQuery(pricePointsRepo.allQuery(), ['price_points']);
  const book = useMemo(() => buildPriceBook(rows), [rows]);

  return { book, isLoading };
};
