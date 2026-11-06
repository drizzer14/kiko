import { ADDED_MCC_CODES, categoryForMcc } from '@kiko/monobank/mcc-category';

import { winningRule } from './prepare-rules';
import { subjectOfStoredRow } from './rule-subject';
import { categoryKeyOf, isSameCategory } from './same-category';
import type { PreparedRules, RewriteCandidate } from './category-rules.d';

// The fields that keep a row's category out of a rule's reach once they are set: a row the user
// picked by hand, a balance-setting row and a split-change row. An exchange leg is NOT here: a rule
// reaches it by the label it shows, on the insert, the rewrite and the re-sync refresh alike, and
// the statistics leave it out of spending by its counterpart or untracked marker, whatever
// category it holds. A synced debit that a Convert marked with the pair id alone has neither
// marker: it leaves spending only as half of a same-currency equal move (the statistics pair
// rule), and otherwise still counts, so a rule may move it between category slices with the total
// unchanged. The insert-time refresh builds its SQL from this list too, typed over it, so the
// two cannot name different rows.
export const REWRITE_GUARD_FIELDS = [
  'categorySetByHand',
  'setsBalance',
  'changeGroupId',
] as const satisfies readonly (keyof RewriteCandidate)[];

export type RewriteGuardField = (typeof REWRITE_GUARD_FIELDS)[number];

const isUnset = (value: string | boolean | null): boolean => value === null || value === false;

export const isRewriteEligible = (row: RewriteCandidate): boolean =>
  REWRITE_GUARD_FIELDS.every((field) => isUnset(row[field]));

// A row the app can still file on its own: no category, `other`, or a key no category holds any
// more (it folds into the default for display). Everything else was chosen by someone, or by a
// rule, and counts as real. `knownCategoryKeys` holds `categoryKeyOf(key)` for every category.
export const hasNoRealCategory = (
  row: { category: string | null },
  knownCategoryKeys: ReadonlySet<string>,
): boolean =>
  row.category === null ||
  isSameCategory(row.category, 'other') ||
  !knownCategoryKeys.has(categoryKeyOf(row.category));

const ADDED_MCC_CODE_SET: ReadonlySet<number> = new Set(ADDED_MCC_CODES);

// Reads the added codes only: a code of the original map never produced `other`, so a stored row
// holding one was moved there by a rule or a pick. A category the user deleted is never brought
// back, and a rule that wins a row, whatever it targets, keeps it. The cheap checks run before
// the rule match.
export const planMccBackfill = (
  prepared: PreparedRules,
  rows: readonly RewriteCandidate[],
  knownCategoryKeys: ReadonlySet<string>,
): { id: string; category: string }[] =>
  rows.flatMap((row) => {
    if (row.mcc === null || !ADDED_MCC_CODE_SET.has(row.mcc)) {
      return [];
    }

    const category = categoryForMcc(row.mcc);
    const isPlanned =
      knownCategoryKeys.has(categoryKeyOf(category)) &&
      hasNoRealCategory(row, knownCategoryKeys) &&
      isRewriteEligible(row) &&
      winningRule(prepared, subjectOfStoredRow(row)) === undefined;

    return isPlanned ? [{ id: row.id, category }] : [];
  });

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
