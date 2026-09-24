import { holdingsRepo } from '@kiko/holdings/repo';
import { defaultHoldingColor } from '@kiko/holdings/entity-colors';
import { holdingTypeSymbol } from '@kiko/holdings/entity-symbols';

import { useLiveQuery } from '../../../db/use-live-query';
import { accountsRepo } from '../../../accounts/accounts.repo';
import { resolveEntityColor } from '../../../design-system/entity-tint';
import type { TargetHoldingOption } from '../target-holding-sheet/target-holding-sheet.props';

/**
 * Joins the holding rows this screen is scoped to (per `accountId`, or every
 * holding when absent) against the account rows this device knows about, so
 * `TargetHoldingSheet` gets a fully-formed `accountName` per row without
 * owning any repo dependency of its own. Extracted out of
 * `statement-import.screen.tsx` so `column-mapping.screen.tsx` can share it
 * rather than reimplementing the same join.
 */
export const useTargetHoldingOptions = (accountId: string | undefined): TargetHoldingOption[] => {
  const { data: holdingRows } = useLiveQuery(
    accountId ? holdingsRepo.listByAccountQuery(accountId) : holdingsRepo.allQuery(),
    ['holdings'],
  );
  const { data: accountRows } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const accountNameById = new Map(accountRows.map((row) => [row.id, row.name] as const));

  return holdingRows.map((holding) => ({
    id: holding.id,
    name: holding.name,
    accountId: holding.accountId,
    accountName: accountNameById.get(holding.accountId) ?? '',
    icon: holding.icon ?? holdingTypeSymbol[holding.type],
    color: resolveEntityColor(holding.color, defaultHoldingColor[holding.type]),
  }));
};
