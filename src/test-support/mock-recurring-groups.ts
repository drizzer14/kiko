import { buildRateTable } from '@kiko/rates/net-worth-view';
import type { RecurringSeries } from '@kiko/recurring/detection';
import { recurringGroupsOf } from '@kiko/recurring/recurring-groups';

const DEFAULT_CATEGORY = { key: 'other', title: 'Other', icon: 'tag.fill', color: null };

/**
 * A stand-in for `useRecurringGroups` in a suite that does not test the groups: the real
 * grouping over no charge rows, so every shown series lands in the one default category group,
 * in the order the groups give (the active series, then the stopped ones), and the hook never
 * loads. Use it as `jest.mock('@kiko/recurring/use-recurring-groups', () =>
 * jest.requireActual('@kiko/test-support/mock-recurring-groups'))`.
 */
export const useRecurringGroups = (shown: readonly RecurringSeries[]) => ({
  ...recurringGroupsOf({
    shown,
    rows: [],
    categories: [DEFAULT_CATEGORY],
    defaultCategoryKey: DEFAULT_CATEGORY.key,
    baseCurrency: 'UAH',
    rateTable: buildRateTable([]),
  }),
  isLoading: false,
});
