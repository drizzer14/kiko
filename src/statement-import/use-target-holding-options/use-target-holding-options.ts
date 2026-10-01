import { useLiveQuery } from '@kiko/db';
import { accountsRepo } from '@kiko/accounts';
import { holdingsRepo } from '@kiko/holdings/repo';
import { isSyncedHolding } from '@kiko/holdings/deletable';
import { defaultHoldingColor } from '@kiko/holdings/entity-colors';
import { defaultHoldingSymbol } from '@kiko/holdings/entity-symbols';
import { resolveEntityColor } from '@kiko/design-system/entity-tint';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import type { TargetHoldingOption } from '@kiko/design-system/components/target-holding-sheet';

type TargetHoldingOptions = {
  options: TargetHoldingOption[];
  isLoading: boolean;
};

/**
 * Joins the holding rows this screen is scoped to (`accountId`'s own) against
 * the account rows this device knows about, so `TargetHoldingSheet` gets a
 * fully-formed `accountName` per row without owning any repo dependency of
 * its own. Extracted out of `statement-import.screen.tsx` so
 * `column-mapping.screen.tsx` can share it rather than reimplementing the
 * same join.
 *
 * Only an open holding that keeps a ledger and no sync owns is offered: a
 * ledgerless holding (a deposit, a bond, metal, property) takes its value from
 * its own metadata, so imported rows would change nothing it shows, and a
 * closed or synced holding takes no new rows from the user.
 *
 * `isLoading` is true while either query is still on its own first load
 * (kiko-architecture's useLiveQuery consumer rule) — a caller must not treat
 * an empty `options` list as "no holdings" while it is still true, or the
 * target-holding picker briefly shows only "Create new holding" for an
 * account that genuinely has holdings not yet loaded.
 */
export const useTargetHoldingOptions = (accountId: string): TargetHoldingOptions => {
  const { data: holdingRows, isLoading: holdingsLoading } = useLiveQuery(
    holdingsRepo.listByAccountQuery(accountId),
    ['holdings'],
  );
  const { data: accountRows, isLoading: accountsLoading } = useLiveQuery(accountsRepo.listQuery(), [
    'accounts',
  ]);
  const accountById = new Map(accountRows.map((row) => [row.id, row] as const));

  const options = holdingRows
    .filter(
      (holding) =>
        holding.closedAt == null &&
        !isLedgerlessHoldingType(holding.type) &&
        !isSyncedHolding(holding, accountById.get(holding.accountId)),
    )
    .map((holding) => ({
      id: holding.id,
      name: holding.name,
      accountId: holding.accountId,
      accountName: accountById.get(holding.accountId)?.name ?? '',
      icon: holding.icon ?? defaultHoldingSymbol(holding),
      color: resolveEntityColor(holding.color, defaultHoldingColor[holding.type]),
    }));

  return { options, isLoading: holdingsLoading || accountsLoading };
};
