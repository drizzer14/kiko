import type { TFunction } from 'i18next';
import { accountIdentity } from '@kiko/holdings/account-identity';
import type { AccountRow, CategoryRow, HoldingRow } from '@kiko/db';
import { visibleSelection } from '@kiko/design-system/visible-selection';
import type { CategoryDisplay } from '@kiko/categories/category-display';
import type { FilterOption } from '@kiko/design-system/components/filter-menu';
import { accountDisplayName, accountsForFilter } from '@kiko/holdings/implicit-account';

import { type CategorySlice, resolveCategoryColor } from '../category-breakdown';

export type FilterScope = {
  optionAccounts: AccountRow[];
  /** The stored pick pruned against the options; empty means all. */
  visibleSelectedAccounts: Set<string>;
  filteredAccounts: AccountRow[];
  /** Open holdings only: every "now" snapshot. */
  visibleHoldings: HoldingRow[];
  /** Closed holdings too: the net-worth line. */
  netWorthHoldings: HoldingRow[];
};

/**
 * Only non-archived accounts are ever shown; the account filter narrows within those.
 * `visibleHoldings` (open AND under a surviving account) feeds every "now" snapshot (the by-type
 * bar, the account pie, the Debts total). `netWorthHoldings` feeds the net-worth LINE instead:
 * the same account filter, but WITHOUT the `closedAt` filter — a closed holding still needs its
 * real value on every bucket before it closed (`buildNetWorthSeries` zeros it only at/after the
 * exact instant it closed), and kiko-pricing's history chart needs a closed holding's own past
 * prices the same way it needs its own past lots.
 */
export const buildFilterScope = (input: {
  accounts: readonly AccountRow[];
  holdings: readonly HoldingRow[];
  selectedAccounts: Set<string>;
}): FilterScope => {
  const { accounts, holdings, selectedAccounts } = input;
  const visibleAccounts = accounts.filter((account) => account.archivedAt == null);
  // The stored selection can name an account archived or deleted since, with no
  // checked row left to clear it, so it is pruned against the filter's OPTIONS
  // and an empty result is "All". The options leave out an implicit account
  // with no holding left: it holds nothing, so "All" totals are unchanged,
  // while `visibleAccounts` and everything computed from it stay as they were.
  const optionAccounts = accountsForFilter(accounts, holdings);
  const visibleSelectedAccounts = visibleSelection(
    selectedAccounts,
    optionAccounts.map((account) => account.id),
  );
  const filteredAccounts = visibleAccounts.filter((account) => {
    return visibleSelectedAccounts.size === 0 || visibleSelectedAccounts.has(account.id);
  });
  const filteredAccountIds = new Set(filteredAccounts.map((account) => account.id));
  const netWorthHoldings = holdings.filter((holding) => filteredAccountIds.has(holding.accountId));
  const visibleHoldings = netWorthHoldings.filter((holding) => holding.closedAt == null);

  return {
    optionAccounts,
    visibleSelectedAccounts,
    filteredAccounts,
    visibleHoldings,
    netWorthHoldings,
  };
};

/**
 * One option per visible account (an implicit account with no holding left excepted, see
 * `accountsForFilter`), each carrying the account's own identity icon + color for the menu row;
 * matching keys on `option.value` (the account id, compared to `account.id` in
 * `buildFilterScope`, so a selection survives a rename and a language switch, and same-named
 * accounts stay separate options); the `label` is the display name, which an implicit account
 * localizes.
 */
export const buildAccountOptions = (
  optionAccounts: readonly AccountRow[],
  t: TFunction,
): FilterOption[] =>
  optionAccounts.map((account) => ({
    value: account.id,
    label: accountDisplayName(account, t),
    ...accountIdentity(account),
  }));

/**
 * The category FilterMenu matches/stores by the STABLE `categories.key` slug, never by the
 * resolved display title: the title is language-dependent (a default category's title changes
 * under a live language switch — see resolveDefaultCategoryTitle), so keying selection on it
 * would silently desync the moment the app language changes, leaving a stale Set of
 * now-nonexistent title strings. The options are one per distinct slice KEY, each carrying the
 * slice's own icon + color and its current localized title as the row's `label`, de-duplicated
 * by key, first-seen-wins.
 *
 * A category the user already SELECTED (or already SAVED as a manual trend key — the trend
 * Filters sheet reuses this same list) can drop out of the range-scoped slices (e.g. the range
 * moves to a week with no spending in it): `keptKeys` unions it back in from `categoryByKey` so
 * the menus still list it, checked, rather than silently hiding a selection the user can then
 * never find and uncheck (a hidden selection stays visible).
 *
 * The options are presented in the user's CUSTOM category order — the live `categories` query is
 * already sorted `asc(sortOrder), asc(key)` (see categories.repo's allQuery) — not in the
 * spending-magnitude order the breakdown happens to emit. Ranked by the STABLE lowercased slug
 * (never the localized title), so the ordering holds across a live language switch. An option
 * whose key has no matching category row (the synthetic default / uncategorized catch-all keyed
 * by DEFAULT_CATEGORY_KEY) sorts LAST. Equal-rank options keep their first-seen (Map insertion)
 * order, which Array.prototype.sort preserves — it is a stable sort (ES2019+).
 */
export const buildCategoryOptions = (input: {
  slices: readonly CategorySlice[];
  categories: readonly Pick<CategoryRow, 'key'>[];
  categoryByKey: ReadonlyMap<string, CategoryDisplay>;
  keptKeys: Iterable<string>;
}): FilterOption[] => {
  const { slices, categories, categoryByKey, keptKeys } = input;
  const byKey = new Map<string, FilterOption>();

  for (const slice of slices) {
    if (byKey.has(slice.key)) {
      continue;
    }
    byKey.set(slice.key, {
      value: slice.key,
      label: slice.title,
      icon: slice.icon,
      color: slice.color,
    });
  }

  for (const key of new Set(keptKeys)) {
    if (byKey.has(key)) {
      continue;
    }

    const display = categoryByKey.get(key);

    if (display === undefined) {
      continue;
    }

    byKey.set(key, {
      value: key,
      label: display.title,
      icon: display.icon,
      color: resolveCategoryColor(display.color, key),
    });
  }

  const orderByKey = new Map<string, number>();
  categories.forEach((category, index) => {
    orderByKey.set(category.key.toLowerCase(), index);
  });
  const rank = (key: string): number => orderByKey.get(key.toLowerCase()) ?? categories.length;

  return Array.from(byKey.values()).sort((a, b) => rank(a.value) - rank(b.value));
};

/**
 * The stored selection can name a category deleted since, with no checked row left to clear it,
 * so it is pruned against the KNOWN keys (the category rows and the slices, which carry the
 * synthetic default). A key that merely fell out of the range is still known and stays selected.
 */
export const visibleCategorySelection = (
  selectedCategories: Set<string>,
  categoryByKey: ReadonlyMap<string, CategoryDisplay>,
  slices: readonly CategorySlice[],
): Set<string> =>
  visibleSelection(selectedCategories, [
    ...categoryByKey.keys(),
    ...slices.map((slice) => slice.key),
  ]);

/**
 * A selection is translated into the set of KEYS to EXCLUDE from the pie: an empty selection
 * excludes nothing (all included), otherwise every category whose KEY is not selected is
 * excluded.
 */
export const excludedCategoryKeysOf = (
  slices: readonly CategorySlice[],
  visibleSelected: Set<string>,
): Set<string> => {
  if (visibleSelected.size === 0) {
    return new Set<string>();
  }

  return new Set(
    slices.filter((slice) => !visibleSelected.has(slice.key)).map((slice) => slice.key),
  );
};
