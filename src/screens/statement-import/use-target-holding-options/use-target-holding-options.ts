import { holdingsRepo } from '@kiko/holdings/repo';
import { holdingTypeSymbol } from '@kiko/holdings/entity-symbols';
import { defaultHoldingColor } from '@kiko/holdings/entity-colors';

import { useLiveQuery } from '../../../db/use-live-query';
import { accountsRepo } from '../../../accounts/accounts.repo';
import { resolveEntityColor } from '../../../design-system/entity-tint';
import type { TargetHoldingOption } from '../target-holding-sheet/target-holding-sheet.props';

type TargetHoldingOptions = {
  options: TargetHoldingOption[];
  isLoading: boolean;
};

/**
 * Joins the holding rows this screen is scoped to (per `accountId`, or every
 * holding when absent) against the account rows this device knows about, so
 * `TargetHoldingSheet` gets a fully-formed `accountName` per row without
 * owning any repo dependency of its own. Extracted out of
 * `statement-import.screen.tsx` so `column-mapping.screen.tsx` can share it
 * rather than reimplementing the same join.
 *
 * `isLoading` is true while either query is still on its own first load
 * (kiko-architecture's useLiveQuery consumer rule) — a caller must not treat
 * an empty `options` list as "no holdings" while it is still true, or the
 * target-holding picker briefly shows only "Create new holding" for an
 * account that genuinely has holdings not yet loaded.
 */
export const useTargetHoldingOptions = (accountId: string | undefined): TargetHoldingOptions => {
  const { data: holdingRows, isLoading: holdingsLoading } = useLiveQuery(
    accountId ? holdingsRepo.listByAccountQuery(accountId) : holdingsRepo.allQuery(),
    ['holdings'],
  );
  const { data: accountRows, isLoading: accountsLoading } = useLiveQuery(accountsRepo.listQuery(), [
    'accounts',
  ]);
  const accountNameById = new Map(accountRows.map((row) => [row.id, row.name] as const));

  const options = holdingRows.map((holding) => ({
    id: holding.id,
    name: holding.name,
    accountId: holding.accountId,
    accountName: accountNameById.get(holding.accountId) ?? '',
    icon: holding.icon ?? holdingTypeSymbol[holding.type],
    color: resolveEntityColor(holding.color, defaultHoldingColor[holding.type]),
  }));

  return { options, isLoading: Boolean(holdingsLoading) || Boolean(accountsLoading) };
};
