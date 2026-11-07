import { buildRateTable } from '@kiko/rates/net-worth-view';
import { recurringGroupsOf } from '@kiko/recurring/recurring-groups';
import type { useRecurringGroups as useActualRecurringGroups } from '@kiko/recurring/use-recurring-groups';

const DEFAULT_CATEGORY = { key: 'other', title: 'Other', icon: 'tag.fill', color: null };

// The testIDs of the removed hidden-merchants UI (the "Hidden" heading, each hidden line and its
// "Show again" button): a screen suite counts none of them in the list.
export const REMOVED_PARTS = /^recurring-charges-(heading-hidden|hidden-|show-again-)/;

/**
 * A stand-in for `useRecurringGroups` in a suite that does not test the groups: the real
 * grouping over no charge rows, so every shown series lands in the one default category group,
 * in the order the groups give (the active series, then the stopped ones), and the hook never
 * loads. Wire it with `import { useRecurringGroups as mockUseRecurringGroups } from
 * '@kiko/test-support/mock-recurring-groups'` and
 * `jest.mock('@kiko/recurring/use-recurring-groups', () => ({ useRecurringGroups:
 * (shown: RecurringSeries[]) => mockUseRecurringGroups(shown) }))`: `jest.mock` hoists, so only a
 * `mock`-prefixed name works there. The `satisfies` makes a change to the real hook's signature
 * fail the typecheck here.
 */
export const useRecurringGroups = ((shown) => ({
  ...recurringGroupsOf({
    shown,
    rows: [],
    categories: [DEFAULT_CATEGORY],
    defaultCategoryKey: DEFAULT_CATEGORY.key,
    baseCurrency: 'UAH',
    rateTable: buildRateTable([]),
    // The suites that use this stand-in assert the order and the totals, never a color.
    scheme: 'dark',
  }),
  isLoading: false,
})) satisfies typeof useActualRecurringGroups;
