import type { AccountRow, HoldingRow } from '../db/schema';

type ArchivableAccount = Pick<AccountRow, 'id' | 'archivedAt'>;
type ClosableHolding = Pick<HoldingRow, 'accountId' | 'closedAt'>;

// A holding counts toward net worth only when it is open (no `closedAt`) AND its
// parent account is not archived (no `archivedAt`). This is the ONE place that
// rule lives, so every caller agrees on which holdings are active.
export const activeHoldings = <Holding extends ClosableHolding>(
  holdings: readonly Holding[],
  accounts: readonly ArchivableAccount[],
): Holding[] => {
  const archivedAccountIds = new Set(
    accounts.filter((account) => account.archivedAt != null).map((account) => account.id),
  );

  return holdings.filter(
    (holding) => holding.closedAt == null && !archivedAccountIds.has(holding.accountId),
  );
};
