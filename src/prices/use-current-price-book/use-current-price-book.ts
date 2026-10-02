import { type LiveQueryOptions, useLiveQuery } from '@kiko/db';

import { dayKeyOf } from '../price-book';
import { pricePointsRepo } from '../price-points-repo';
import { usePriceBookOfPoints } from '../use-price-book';

type UseCurrentPriceBookResult = ReturnType<typeof usePriceBookOfPoints>;

/**
 * The `PriceBook` for a screen that values only `now` or later (Home,
 * Accounts, the account and holding details, the holding form): the same
 * contract as `usePriceBook`, but it reads `pricePointsRepo.currentQuery`, so
 * the book holds a metal's latest price rather than every daily
 * close it ever stored. Every number such a screen shows is the same one the
 * whole-table book gives; a screen that values a past day (statistics) reads
 * `usePriceBook`.
 *
 * `now` is the instant the screen values at, so the book and the screen
 * agree on which day is "today" even when the screen holds an older `now`
 * than the clock; a screen with a fixed `now` passes it.
 */
export const useCurrentPriceBook = (
  enabled = true,
  options: LiveQueryOptions = {},
  loanPaymentsEnabled = enabled,
  now = Date.now(),
): UseCurrentPriceBookResult => {
  const points = useLiveQuery(
    pricePointsRepo.currentQuery(dayKeyOf(now)),
    ['price_points'],
    enabled,
    options,
  );

  return usePriceBookOfPoints(points, enabled, options, loanPaymentsEnabled);
};
