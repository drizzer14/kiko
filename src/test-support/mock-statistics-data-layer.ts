/**
 * Importing this module mocks the data layer a real Statistics screen (and Home, whose companion
 * pane is one) needs to mount: every repo query is an empty stub, `useLiveQuery` answers through
 * `mockUseLiveQuery` (set it to `answerFilterData` from `statistics-filter-data`), the rate
 * backfill never settles, and the visible-refreshed `now` stays the mount-time clock. Import it
 * BEFORE the screen under test, so the mocks register first.
 *
 * The `jest.mock` calls below register when this helper is evaluated, so a test must import it
 * before any module that loads a mocked module. That holds while the module under test is a
 * relative import, because relative imports sort after `@kiko/*` imports. A new `@kiko/*` value
 * import that loads a mocked module and sorts ahead of this helper would silently keep the real
 * binding.
 */
export const mockUseLiveQuery = jest.fn();

const mockNoQuery = { toSQL: () => ({ sql: '', params: [] }) };

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { listQuery: () => mockNoQuery },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => mockNoQuery,
    balanceOf: (row: { currency: string; balanceMinorUnits: number }) => ({
      currency: row.currency,
      minorUnits: row.balanceMinorUnits,
    }),
  },
}));
jest.mock('@kiko/rates/repo', () => ({ ratesRepo: { allQuery: () => mockNoQuery } }));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => mockNoQuery, setTrendFilter: jest.fn() },
}));
jest.mock('@kiko/categories/repo', () => ({ categoriesRepo: { allQuery: () => mockNoQuery } }));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listAllQuery: () => mockNoQuery,
    listWithContextBetweenQuery: () => ({ kind: 'rows', ...mockNoQuery }),
    contextSpanQuery: () => ({ kind: 'span', ...mockNoQuery }),
    contextCategoriesQuery: () => ({ kind: 'categories', ...mockNoQuery }),
    loanLedgerPaymentsQuery: () => mockNoQuery,
    removePlan: async () => ({ split: false }),
  },
}));
jest.mock('@kiko/sync/use-sync-all', () => ({
  useSyncAll: () => ({ failures: [], syncAll: jest.fn() }),
}));
jest.mock('@kiko/monobank/sync-status', () => ({
  useSyncStatus: () => false,
  useSyncProgress: () => ({ completed: 0, total: 0 }),
}));
jest.mock('@kiko/navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: jest.fn(),
}));
jest.mock('@kiko/rates/history-backfill', () => ({
  ...jest.requireActual('@kiko/rates/history-backfill'),
  runBackfill: () => new Promise<never>(() => {}),
}));
jest.mock('@kiko/design-system/use-visible-refreshed-now/use-visible-refreshed-now', () => {
  const { useState } = jest.requireActual('react');

  return { useVisibleRefreshedNow: () => useState(() => Date.now())[0] };
});
