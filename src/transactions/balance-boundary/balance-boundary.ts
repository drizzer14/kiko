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

/** Whether a statement row dated `time` moves the stored balance. A row dated at
 * or before the boundary is history: the balance set at the boundary already
 * counts it, the same as `postClosingRowsWhere`'s strict `gt`. Only an import
 * judges its rows this way; a manual write, edit and delete move the balance by
 * the row's full amount whatever its date. */
export const movesBalance = (time: number, boundary: number | null): boolean =>
  boundary === null || time > boundary;
