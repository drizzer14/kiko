import { winningRule } from './prepare-rules';
import { isSameCategory } from './same-category';
import { subjectOfStoredRow } from './rule-subject';
import type { PreparedRules, RewriteCandidate } from './category-rules.d';

// The fields that keep a row's category out of a rule's reach once they are set: a row the user
// picked by hand, an exchange leg (a paired one, one with a counterpart holding, or a transfer to a
// wallet Kiko does not track), a balance-setting row and a split-change row. The insert-time
// refresh builds its SQL from this list too, typed over it, so the two cannot name different rows.
export const REWRITE_GUARD_FIELDS = [
  'categorySetByHand',
  'exchangePairId',
  'exchangeCounterpartHoldingId',
  'untrackedCounterpart',
  'setsBalance',
  'changeGroupId',
] as const satisfies readonly (keyof RewriteCandidate)[];

export type RewriteGuardField = (typeof REWRITE_GUARD_FIELDS)[number];

const isUnset = (value: string | boolean | null): boolean => value === null || value === false;

export const isRewriteEligible = (row: RewriteCandidate): boolean =>
  REWRITE_GUARD_FIELDS.every((field) => isUnset(row[field]));

// Only rows the saved rule wins are planned, so a rule that was narrowed, out-ranked or deleted
// never pulls a row back from the category it already has.
export const planRuleRewrite = (
  prepared: PreparedRules,
  savedRuleId: string,
  rows: readonly RewriteCandidate[],
): string[] => {
  const savedRule = prepared.ordered.find((rule) => rule.id === savedRuleId);

  if (savedRule === undefined) {
    return [];
  }

  return rows
    .filter(
      (row) =>
        isRewriteEligible(row) &&
        !isSameCategory(row.category, savedRule.category) &&
        winningRule(prepared, subjectOfStoredRow(row))?.id === savedRuleId,
    )
    .map((row) => row.id);
};
