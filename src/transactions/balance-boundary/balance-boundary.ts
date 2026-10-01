import type { TransactionRow } from '@kiko/db';

import { isBalanceSetShapedRow } from '../balance-set-row';

type BoundarySources = { balanceSetAt: number | null; newestSyncTime: number | null };

/** THE BOUNDARY (`importRows`): the later of `holdings.balanceSetAt` and the
 * holding's newest sync-source row, treating `null` as "no boundary from this
 * source" rather than as an instant to compare. */
export const balanceBoundaryOf = ({
  balanceSetAt,
  newestSyncTime,
}: BoundarySources): number | null => {
  if (balanceSetAt === null) {
    return newestSyncTime;
  }

  if (newestSyncTime === null) {
    return balanceSetAt;
  }

  return Math.max(balanceSetAt, newestSyncTime);
};

/** Whether a row dated `time` moves the stored balance. A row dated at or before
 * the boundary is history: the balance set at the boundary already counts it,
 * the same as `postClosingRowsWhere`'s strict `gt`. A row that set a balance
 * is judged by its stored mark instead (`editBalanceDelta`,
 * `removeBalanceDelta`), wherever its date has moved. */
export const movesBalance = (time: number, boundary: number | null): boolean =>
  boundary === null || time > boundary;

type PossibleBalanceSetRow = Pick<TransactionRow, 'setsBalance'> &
  Parameters<typeof isBalanceSetShapedRow>[0];

/** Whether `row` may be a balance-set row the stored mark does not show. Before
 * migration 0047 a row carried no mark, so an older set's row that a newer set
 * superseded looks exactly like an uncategorised row an older build wrote. A
 * marked row is judged by its mark, and a row with a description or a category
 * was never a balance-set row. */
export const isPossibleBalanceSetRow = (row: PossibleBalanceSetRow): boolean =>
  !row.setsBalance && isBalanceSetShapedRow(row);

/** Whether moving `row` to `time` takes a possible balance-set row
 * (`isPossibleBalanceSetRow`) from the history side of the boundary to after
 * it, which would add an amount the balance already holds. */
export const redatesPossibleBalanceSetRowPastBoundary = (
  row: Pick<TransactionRow, 'time'> & PossibleBalanceSetRow,
  time: number,
  boundary: number | null,
): boolean =>
  isPossibleBalanceSetRow(row) && !movesBalance(row.time, boundary) && movesBalance(time, boundary);
