import { useLiveQuery } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';

import { transactionsRepo } from '../repo';
import { balanceBoundaryOf } from '../balance-boundary';

/**
 * A holding's balance boundary (`balanceBoundaryOf`), read live. `enabled`
 * `false` runs no query and no subscription, so a screen that never needs
 * the boundary pays nothing; the boundary is `null` until the read lands, the
 * same as a holding with neither source.
 */
export const useBalanceBoundary = (holdingId: string, enabled: boolean): number | null => {
  const { data } = useLiveQuery(
    transactionsRepo.balanceBoundaryQuery(holdingId),
    ['holdings', 'transactions'],
    enabled,
  );

  return foldMap(maybe(data.at(0)), balanceBoundaryOf) ?? null;
};
