import { View } from 'react-native';
import type { ComponentProps } from 'react';
import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';
import HomeScreen from '@kiko/screens/home';
import StatisticsScreen from '@kiko/screens/statistics';
import { formatDate, defaultDateRange } from '@kiko/dates';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

type HomeProps = ComponentProps<typeof HomeScreen>;

/**
 * Both screens read ONE date range (`useDateRangeSelection`), a property no single-screen test can
 * see. This suite renders the REAL Home and Statistics screens in one tree, with the data layer
 * mocked down to what the two screens need to mount, and reads the range each screen's own field
 * shows.
 */

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    balanceOf: (row: { currency: string; balanceMinorUnits: number }) => ({
      currency: row.currency,
      minorUnits: row.balanceMinorUnits,
    }),
  },
}));
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setTrendFilter: jest.fn(),
  },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listAllQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    listWithContextBetweenQuery: () => ({ kind: 'rows', toSQL: () => ({ sql: '', params: [] }) }),
    contextSpanQuery: () => ({ kind: 'span', toSQL: () => ({ sql: '', params: [] }) }),
    contextCategoriesQuery: () => ({ kind: 'categories', toSQL: () => ({ sql: '', params: [] }) }),
    loanLedgerPaymentsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
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
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
  // `useIsScreenVisible` reads the route key; with no pane context it falls back to `useIsFocused`.
  useRoute: () => ({ key: 'route' }),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
// Seeded once per mount, like the real hook: only a return to visibility advances it, never a
// re-render.
jest.mock('@kiko/design-system/use-visible-refreshed-now/use-visible-refreshed-now', () => {
  const { useState } = jest.requireActual('react');

  return { useVisibleRefreshedNow: () => useState(() => Date.now())[0] };
});

const DAYS_BEFORE_TODAY = 3;

const ACCOUNT = { id: 'a', name: 'Monobank', kind: 'bank', color: null };
const HOLDING = {
  id: 'h1',
  accountId: 'a',
  currency: 'UAH',
  type: 'card',
  balanceMinorUnits: 100_000,
  metadata: null,
  closedAt: null,
};

// The oldest transaction sets the calendar's selectable floor; with none, the floor is today and a
// day pick before it is ignored.
// Each it sets this from its own clock and the mocks read it lazily, so the fake-clock midnight it
// never sees a floor computed from the real date.
let oldestTime = 0;

const oldestTransaction = () => ({
  id: 't1',
  holdingId: 'h1',
  time: oldestTime,
  amountMinorUnits: -5000,
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  loanHoldingId: null,
});

const answerLiveQuery = (query: { kind?: string }, tables: string[]) => {
  const byTable: Record<string, unknown[]> = {
    accounts: [ACCOUNT],
    holdings: [HOLDING],
    settings: [{ baseCurrency: 'UAH' }],
    transactions: [oldestTransaction()],
  };
  const ledger: Record<string, unknown[]> = {
    span: [{ earliest: oldestTime, latest: oldestTime }],
  };

  return {
    data:
      tables[0] === 'transactions' && query.kind !== undefined
        ? (ledger[query.kind] ?? [])
        : (byTable[tables[0]] ?? []),
    isLoading: false,
    isFresh: true,
  };
};

const navigation = navigationSpy();

const bothScreens = () => {
  return (
    <>
      <View testID="home-pane">
        <HomeScreen
          navigation={asNavigationProp<HomeProps['navigation']>(navigation)}
          route={asRouteProp<HomeProps['route']>('Home')}
        />
      </View>
      <View testID="statistics-pane">
        <StatisticsScreen />
      </View>
    </>
  );
};

// The net-worth plot carries the scrub line's GestureDetector, which needs a root view.
const renderBoth = (): ReturnType<typeof render> =>
  render(bothScreens(), { wrapper: GestureRootWrapper });

type Rendered = Awaited<ReturnType<typeof render>>;

const rangeLabel = (from: Date, to: Date): string => `${formatDate(from)} – ${formatDate(to)}`;

const defaultLabel = (): string => {
  const range = defaultDateRange();

  return rangeLabel(range.from, range.to);
};

const pane = (rendered: Rendered, testID: string) => within(rendered.getByTestId(testID));

const pickedDay = (): Date => {
  const day = new Date();

  day.setDate(day.getDate() - DAYS_BEFORE_TODAY);

  return day;
};

const applyDayIn = async (rendered: Rendered, testID: string, day: Date): Promise<void> => {
  const scope = pane(rendered, testID);

  await act(async () => {
    await fireEvent.press(scope.getByLabelText('Date range'));
  });
  const calendar = scope.getByTestId('date-range-calendar').props as {
    onDayPress: (value: unknown) => void;
  };

  await act(async () => {
    calendar.onDayPress({
      year: day.getFullYear(),
      month: day.getMonth() + 1,
      day: day.getDate(),
    });
  });
  await act(async () => {
    await fireEvent.press(scope.getByText('Apply'));
  });
};

const clearIn = async (rendered: Rendered, testID: string): Promise<void> => {
  const scope = pane(rendered, testID);

  await act(async () => {
    await fireEvent.press(scope.getByLabelText('Date range'));
  });
  await act(async () => {
    await fireEvent.press(scope.getByText('Clear'));
  });
};

const expectBothShow = (rendered: Rendered, label: string): void => {
  expect(pane(rendered, 'home-pane').queryByText(label)).toBeTruthy();
  expect(pane(rendered, 'statistics-pane').queryByText(label)).toBeTruthy();
};

describe('shared date range across Home and Statistics', () => {
  beforeEach(() => {
    oldestTime = localDaysFrom(Date.now(), -40);
    mockUseLiveQuery.mockImplementation(answerLiveQuery);
  });

  it('shows the same default range on Home and Statistics', async () => {
    const rendered = await renderBoth();

    expectBothShow(rendered, defaultLabel());
  });

  it('shows a range applied on Home on Statistics too', async () => {
    const rendered = await renderBoth();
    const day = pickedDay();

    await applyDayIn(rendered, 'home-pane', day);

    expectBothShow(rendered, rangeLabel(day, day));
  });

  it('shows a range applied on Statistics on Home too', async () => {
    const rendered = await renderBoth();
    const day = pickedDay();

    await applyDayIn(rendered, 'statistics-pane', day);

    expectBothShow(rendered, rangeLabel(day, day));
  });

  it('returns both screens to the default range when Clear is pressed on either', async () => {
    const rendered = await renderBoth();

    await applyDayIn(rendered, 'home-pane', pickedDay());
    await clearIn(rendered, 'statistics-pane');

    expectBothShow(rendered, defaultLabel());
  });

  it('starts both screens on the default range after both unmount and mount again', async () => {
    const first = await renderBoth();

    await applyDayIn(first, 'home-pane', pickedDay());
    await first.unmount();

    expectBothShow(await renderBoth(), defaultLabel());
  });

  describe('across midnight', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('moves both screens to the same new-day range after midnight with no pick', async () => {
      jest.useFakeTimers({ now: new Date(2026, 5, 15, 23, 59, 0) });
      oldestTime = localDaysFrom(Date.now(), -40);
      const rendered = await renderBoth();

      expectBothShow(rendered, defaultLabel());

      // Home reads the new `Date.now()` on re-render; Statistics keeps its mount-time focus `now`.
      jest.setSystemTime(new Date(2026, 5, 16, 0, 1, 0));
      await rendered.rerender(bothScreens());

      expectBothShow(rendered, defaultLabel());
    });
  });
});
