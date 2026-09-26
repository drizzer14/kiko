import { useMemo } from 'react';
import { transactionsRepo } from '@kiko/transactions/repo';

import { pricePointsRepo } from '../price-points-repo';
import { buildPriceBook, type PriceBook } from '../price-book';
import { type LiveQueryOptions, useLiveQuery } from '../../db/use-live-query';

type UsePriceBookResult = { book: PriceBook; isLoading: boolean };

/**
 * Reactive `PriceBook`, subscribed to the whole `price_points` table AND to
 * every linked loan payment (one read across all loans — a loan's
 * outstanding reads its payments on every valuation site). Rebuilt only when
 * a live row set itself changes — `useMemo` keyed on both row sets, so a
 * re-render that touches unrelated state does not re-group every point.
 * `isLoading` is true while EITHER read is on its first load, so a screen can
 * gate its own empty state on it — see `kiko-architecture`'s useLiveQuery
 * consumer rule — and never shows a loan's schedule-only value before its
 * payments arrive.
 *
 * `enabled` (default `true`) forwards straight to `useLiveQuery`'s own
 * `enabled` argument: a screen showing no holding type that ever reads
 * `price_points` (`needsPriceBook`, `src/holdings/priced-value/`) passes
 * `false` so the read never runs at all (kiko-architecture: no request or
 * query for data the user does not have) — never a conditional call to this
 * hook itself, which Rules of Hooks forbids. `book` resolves to
 * `EMPTY_PRICE_BOOK` and `isLoading` to `false` (ready, never stuck) while
 * disabled. `loanPaymentsEnabled` (default: `enabled`) narrows the
 * linked-payments read the same way, for a screen whose priced holdings
 * include no loan; it never runs while `enabled` is `false`.
 *
 * `options` forwards straight to `useLiveQuery`'s own: a DISPLAY screen passes
 * `{ cached: true }` so a reopen shows its prices on the first frame; a form
 * never does (kiko-architecture).
 */
export const usePriceBook = (
  enabled = true,
  options: LiveQueryOptions = {},
  loanPaymentsEnabled = enabled,
): UsePriceBookResult => {
  const { data: rows, isLoading: pointsLoading } = useLiveQuery(
    pricePointsRepo.allQuery(),
    ['price_points'],
    enabled,
    options,
  );
  const { data: payments, isLoading: paymentsLoading } = useLiveQuery(
    transactionsRepo.loanLedgerPaymentsQuery(),
    ['transactions', 'holdings'],
    enabled && loanPaymentsEnabled,
    options,
  );
  const book = useMemo(() => buildPriceBook(rows, payments), [rows, payments]);

  return { book, isLoading: pointsLoading || paymentsLoading };
};
