import { useMemo } from 'react';

import { pricePointsRepo } from '../price-points-repo';
import { buildPriceBook, type PriceBook } from '../price-book';
import { type LiveQueryOptions, useLiveQuery } from '../../db/use-live-query';

type UsePriceBookResult = { book: PriceBook; isLoading: boolean };

/**
 * Reactive `PriceBook`, subscribed to the whole `price_points` table. Rebuilt
 * only when the live row set itself changes — `useMemo` keyed on `rows`, so a
 * re-render that touches unrelated state does not re-group every point.
 * `isLoading` threads straight through from the underlying `useLiveQuery`
 * (first-load only), so a screen can gate its own empty state on it — see
 * `kiko-architecture`'s useLiveQuery consumer rule.
 *
 * `enabled` (default `true`) forwards straight to `useLiveQuery`'s own
 * `enabled` argument: a screen showing no holding type that ever reads
 * `price_points` (`needsPriceBook`, `src/holdings/priced-value/`) passes
 * `false` so the read never runs at all (kiko-architecture: no request or
 * query for data the user does not have) — never a conditional call to this
 * hook itself, which Rules of Hooks forbids. `book` resolves to
 * `EMPTY_PRICE_BOOK` and `isLoading` to `false` (ready, never stuck) while
 * disabled.
 *
 * `options` forwards straight to `useLiveQuery`'s own: a DISPLAY screen passes
 * `{ cached: true }` so a reopen shows its prices on the first frame; a form
 * never does (kiko-architecture).
 */
export const usePriceBook = (
  enabled = true,
  options: LiveQueryOptions = {},
): UsePriceBookResult => {
  const { data: rows, isLoading } = useLiveQuery(
    pricePointsRepo.allQuery(),
    ['price_points'],
    enabled,
    options,
  );
  const book = useMemo(() => buildPriceBook(rows), [rows]);

  return { book, isLoading };
};
