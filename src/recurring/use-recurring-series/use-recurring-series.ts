import { useMemo } from 'react';
import {
  type MarkedChain,
  type MarkedEntry,
  markedSeriesOf,
  detectedBesideMarked,
} from '@kiko/recurring/marked-series';
import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
import { startOfLocalDay } from '@kiko/dates';
import { holdingsRepo } from '@kiko/holdings/repo';
import { useDataReady, useLiveQuery } from '@kiko/db';
import { transactionsRepo } from '@kiko/transactions/repo';
import { useIsScreenVisible } from '@kiko/navigation/pane-stack';
import { type RecurringMerchantChoice, settingsRepo } from '@kiko/settings';
import { useVisibleRefreshedNow } from '@kiko/design-system/use-visible-refreshed-now';
import { type RecurringSeries, chargeGroupsOf, seriesOfGroups } from '@kiko/recurring/detection';

type Choices = ReadonlyMap<string, RecurringMerchantChoice>;

type UseRecurringSeriesResult = {
  series: RecurringSeries[];
  markedSeries: RecurringSeries[];
  withoutCharges: MarkedChain[];
  choices: Choices;
  isLoading: boolean;
};

const NOTHING_FOUND = { series: [], markedSeries: [], withoutCharges: [] };

const markedEntriesOf = (choices: Choices): MarkedEntry[] =>
  [...choices].flatMap(([key, { name, marks = [] }]) =>
    marks.length > 0 ? [{ key, name, marks }] : [],
  );

/**
 * The recurring series of the whole ledger, shared by the list and the series screen, and the
 * merchant choices beside them. Each read is `paused` while the screen is hidden (a write
 * elsewhere shows once it is back) and never `cached`: a second copy of a whole ledger for a
 * screen opened rarely. `isLoading` is true until every read has settled, so a first read still
 * queued never reads as an empty list. Detection waits for that too: reads land one at a time, and
 * a half-landed ledger (rows, no accounts) would run every matcher on a world that rejects each
 * row, only to run them again.
 *
 * Detection keys on the local day of `now`, not on `now`: each return to the screen refreshes
 * `now` with no row change, and must run nothing. The choices are not in that memo either: a
 * settings write then runs no detection and no ledger read, only the marked memo beside it. A hide
 * does not filter `series`, so the series screen keeps its series between a hide and its way back;
 * the list filters. A mark does: `series` leaves out a detected series that shares a row with a
 * marked one, so no row is in two shown series.
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
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.recurringMerchantChoicesQuery(),
    ['settings'],
    true,
    liveOptions,
  );
  const today = startOfLocalDay(useVisibleRefreshedNow(isVisible));
  const isReady = useDataReady(rowsLoading, holdingsLoading, accountsLoading, settingsLoading);
  const detection = useMemo(() => {
    if (!isReady) {
      return undefined;
    }

    const groups = chargeGroupsOf({ rows, holdings, accounts }, today);

    return { groups, detected: seriesOfGroups(groups, today) };
  }, [isReady, rows, holdings, accounts, today]);
  const choices = useMemo(
    () => settingsRepo.recurringMerchantChoicesOf(settingsRows.at(0)?.recurringMerchantChoices),
    [settingsRows],
  );
  const { series, markedSeries, withoutCharges } = useMemo(
    () =>
      foldMap(maybe(detection), ({ groups, detected }) => {
        const marked = markedSeriesOf(groups, markedEntriesOf(choices), today);

        return {
          // With nothing marked the detected array itself stands, so a hide, which marks nothing,
          // hands the screens the series it handed them before.
          series:
            marked.series.length > 0 ? detectedBesideMarked(detected, marked.series) : detected,
          markedSeries: marked.series,
          withoutCharges: marked.withoutCharges,
        };
      }) ?? NOTHING_FOUND,
    [detection, choices, today],
  );

  return { series, markedSeries, withoutCharges, choices, isLoading: !isReady };
};
