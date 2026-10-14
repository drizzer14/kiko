import { match } from 'ts-pattern';
import {
  type PreparedRules,
  type RuleDirection,
  type RuleSubject,
  subjectOfDraft,
  winningRule,
} from '@kiko/categories/category-rules';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { parseAmount } from '@kiko/currency/parse';
import type { Currency } from '@kiko/currency/currency';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';
import { DEFAULT_CATEGORY_KEY, resolveCategoryDisplay } from '@kiko/categories/category-display';

// What the form holds of a transaction while it is filled in, as far as a rule can read it.
// `currency` is the picked holding's, null while no holding is picked.
export type CategoryDraft = {
  description: string;
  amount: string;
  time: number;
  mode: FormMode;
  currency: Currency | null;
};

// A blank or unreadable amount, or one with no holding to give it a currency, is unknown, so a
// rule on the amount never matches it.
const absoluteMinorUnitsOf = (amount: string, currency: Currency | null): number | null => {
  const major = parseAmount(amount);

  if (currency === null || Number.isNaN(major)) {
    return null;
  }

  return Money.fromMajor(currency, major).minorUnits;
};

const subjectInDirection = (draft: CategoryDraft, direction: RuleDirection): RuleSubject =>
  subjectOfDraft({
    description: draft.description,
    absoluteMinorUnits: absoluteMinorUnitsOf(draft.amount, draft.currency),
    currency: draft.currency,
    direction,
    time: draft.time,
  });

// The subject the rules see for a draft, or null in exchange mode, which carries no category. A
// split's payment is stored as an expense, so it reads as one.
export const subjectOfFormDraft = (draft: CategoryDraft): RuleSubject | null =>
  match(draft.mode)
    .with('exchange', () => null)
    .with('income', () => subjectInDirection(draft, 'income'))
    .with('expense', 'split', () => subjectInDirection(draft, 'expense'))
    .exhaustive();

// The category of the rule that wins for `subject`, or null when no rule matches. Matching is
// JS-normalized (never SQL), the same evaluation the sync insert path uses.
const ruleCategoryFor = (subject: RuleSubject, prepared: PreparedRules): string | null =>
  winningRule(prepared, subject)?.category ?? null;

// The category the rules give the whole draft, or null when none matches. Kept module-level and
// pure so the draft branches stay out of the screen component's cognitive-complexity budget.
export const categoryForDraft = (draft: CategoryDraft, prepared: PreparedRules): string | null =>
  foldMap(maybe(subjectOfFormDraft(draft)), (subject) => ruleCategoryFor(subject, prepared)) ??
  null;

// Whether the form offers the name rule at all: an edit that changed the category always does; a
// create does only for a category the user chose (a pick, or a seed a Duplicate or a template
// carries), because applying one the rules pre-selected would rewrite every same-name row to a
// category nobody chose. Kept module-level so its operators stay out of the screen component's
// cognitive-complexity budget.
export const offersCategoryNameRule = ({
  categoryChanged,
  isEditing,
  userPickedCategory,
}: {
  categoryChanged: boolean;
  isEditing: boolean;
  userPickedCategory: boolean;
}): boolean => categoryChanged && (isEditing || userPickedCategory);

// Whether `save` needs to raise the propagation-confirm sheet, and with what
// payload: only when the form offers a name rule (`offersNameRule`: the category changed to one
// the user chose) AND the affected name is non-blank. `applyNameRule` refuses to write a rule
// for a blank normalized name (it must not become a catch-all), so confirming propagation
// for one asked `Apply "Groceries" to all transactions named ""?` and then
// wrote nothing — the row's own category is already persisted by `writeManual`
// regardless, so `save` just returns to the list instead. Kept module-level
// and pure for the same cognitive-complexity-budget reason as
// `MODE_BEHAVIOR`'s field-error functions. The request names the row the save wrote (or edited),
// so "Apply" can hand it to the rule: that row follows the new rule instead of staying a hand pick.
export type CategoryOverrideRequest = {
  name: string;
  category: string;
  sourceTransactionId: string | null;
};

export const resolveCategoryOverrideRequest = (
  offersNameRule: boolean,
  selectedCategory: string | null,
  name: string,
  sourceTransactionId: string | null,
): CategoryOverrideRequest | null => {
  if (!offersNameRule || selectedCategory === null || normalizeTransactionName(name) === '') {
    return null;
  }

  return { name, category: selectedCategory, sourceTransactionId };
};

// Resolve the pending override's category into the icon name and the confirm
// copy the "Apply Category to All" sheet shows. The sheet renders the glyph
// white (textPrimary), not its category color, so only the icon name is needed
// here. Kept module-level so its null branch stays out of the screen
// component's cognitive-complexity budget.
type PendingCategoryView = { icon: string; message: string };

// `buildMessage` resolves the catalog's interpolated confirm copy; passed in
// (rather than read from a module-level template) so this helper stays
// translation-agnostic.
export const resolvePendingCategory = (
  pendingOverride: { name: string; category: string } | null,
  categoryByKey: Parameters<typeof resolveCategoryDisplay>[1],
  buildMessage: (category: string, name: string) => string,
): PendingCategoryView | null => {
  if (pendingOverride === null) {
    return null;
  }

  // `pendingOverride.category` is always a user-PICKED, valid category key, so
  // the default-category fallback is never consulted here — the shared constant
  // is passed only to satisfy the resolver's signature (no settings read needed).
  const display = resolveCategoryDisplay(
    pendingOverride.category,
    categoryByKey,
    DEFAULT_CATEGORY_KEY,
  );

  return {
    icon: display.icon,
    message: buildMessage(display.title, pendingOverride.name.trim()),
  };
};
