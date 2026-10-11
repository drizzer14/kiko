import { winningRule } from './prepare-rules';
import { subjectOfStoredRow } from './rule-subject';
import type { PreparedRules, RewriteCandidate } from './category-rules.d';

// A row the user picked by hand, an exchange leg, a balance-setting row and a split-change row
// keep the category they have: a rule never re-sorts them.
export const isRewriteEligible = (row: RewriteCandidate): boolean =>
  !row.categorySetByHand &&
  row.exchangePairId === null &&
  row.exchangeCounterpartHoldingId === null &&
  !row.setsBalance &&
  row.changeGroupId === null;

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
        row.category !== savedRule.category &&
        winningRule(prepared, subjectOfStoredRow(row))?.id === savedRuleId,
    )
    .map((row) => row.id);
};
