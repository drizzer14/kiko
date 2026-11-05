import { useMemo } from 'react';
import { accountsRepo } from '@kiko/accounts';
import { startOfLocalDay } from '@kiko/dates';
import { holdingsRepo } from '@kiko/holdings/repo';
import { useDataReady, useLiveQuery } from '@kiko/db';
import { transactionsRepo } from '@kiko/transactions/repo';
import { useIsScreenVisible } from '@kiko/navigation/pane-stack';
import { useVisibleRefreshedNow } from '@kiko/design-system/use-visible-refreshed-now';
import { type RecurringSeries, detectRecurringSeries } from '@kiko/recurring/detection';

type UseRecurringSeriesResult = { series: RecurringSeries[]; isLoading: boolean };

/**
 * The recurring series of the whole ledger, shared by the list and the series screen. Each read is
 * `paused` while the screen is hidden (a write elsewhere shows once it is back) and never
 * `cached`: a second copy of a whole ledger for a screen opened rarely. `isLoading` is true until
 * every read has settled, so a first read still queued never reads as an empty list.
 *
 * Detection keys on the local day of `now`, not on `now`: each return to the screen refreshes
 * `now` with no row change, and must run nothing.
 */
export const useRecurringSeries = (): UseRecurringSeriesResult => {
  const isVisible = useIsScreenVisible();
  const liveOptions = { paused: !isVisible } as const;
  const { data: rows, isLoading: rowsLoading } = useLiveQuery(
    transactionsRepo.recurringLedgerQuery(),
    ['transactions'],
    true,
    liveOptions,
  );
  const { data: holdings, isLoading: holdingsLoading } = useLiveQuery(
    holdingsRepo.allQuery(),
    ['holdings'],
    true,
    liveOptions,
  );
  const { data: accounts, isLoading: accountsLoading } = useLiveQuery(
    accountsRepo.listQuery(),
    ['accounts'],
    true,
    liveOptions,
  );
  const today = startOfLocalDay(useVisibleRefreshedNow(isVisible));
  const isReady = useDataReady(rowsLoading, holdingsLoading, accountsLoading);
  const series = useMemo(
    () => detectRecurringSeries({ rows, holdings, accounts }, today),
    [rows, holdings, accounts, today],
  );

  return { series, isLoading: !isReady };
};
