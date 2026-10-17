// The backfill never resolves, so the net-worth line stays in its loading state and nothing here
// reaches the network.
jest.mock('@kiko/rates/history-backfill', () => ({
  ...jest.requireActual('@kiko/rates/history-backfill'),
  runBackfill: () => new Promise<never>(() => {}),
}));

jest.mock('@kiko/navigation/pane-stack', () => ({ useIsScreenVisible: () => true }));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('@kiko/navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: () => undefined,
}));

jest.mock('@kiko/design-system/use-visible-refreshed-now/use-visible-refreshed-now', () => ({
  useVisibleRefreshedNow: () => Date.now(),
}));

// The mount counter proves a card keeps its place in the tree across an interaction: a grid that
// re-laid out on a filter change would unmount and remount it.
const mockNetWorthLineMounts = jest.fn();

jest.mock('./net-worth-line', () => {
  const { useEffect } = jest.requireActual('react');

  return {
    __esModule: true,
    default: () => {
      useEffect(() => {
        mockNetWorthLineMounts();
      }, []);

      return null;
    },
  };
});

// The window and the size class are what a real device reports; each test sets them.
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

let mockSizeClass: 'compact' | 'regular' = 'compact';

jest.mock('@kiko/display-regions', () => ({
  ...jest.requireActual('@kiko/display-regions'),
  useDisplayRegions: () => ({ horizontalSizeClass: mockSizeClass }),
}));

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
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listAllQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    loanLedgerPaymentsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

import { DAY_MS } from '@kiko/dates';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';
import { darkTheme } from '@kiko/design-system/theme';
import { toUtcMidnight } from '@kiko/rates/history-entry';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import { testIdsInOrder } from '@kiko/test-support/test-ids-in-order';
import { act, fireEvent, render } from '@testing-library/react-native';
import { PaneContext, PaneWidthContext, paneContextOf } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import StatisticsScreen from './statistics.screen';

const now = Date.now();

const tables: Record<string, unknown[]> = {
  accounts: [
    { id: 'a', name: 'Cash', kind: 'cash', color: null },
    { id: 'b', name: 'Bank', kind: 'bank', color: null },
  ],
  holdings: [
    {
      id: 'h1',
      accountId: 'a',
      currency: 'UAH',
      type: 'cash',
      balanceMinorUnits: 100_000,
      metadata: null,
      closedAt: null,
    },
    {
      id: 'h2',
      accountId: 'b',
      currency: 'USD',
      type: 'card',
      balanceMinorUnits: 5_000,
      metadata: null,
      closedAt: null,
    },
  ],
  currency_rates: [{ base: 'USD', quote: 'UAH', rate: '40' }],
  settings: [{ baseCurrency: 'UAH' }],
  transactions: [
    { id: 't1', holdingId: 'h1', time: localDaysFrom(now, -3), amountMinorUnits: 50_000 },
    { id: 't2', holdingId: 'h2', time: localDaysFrom(now, -3), amountMinorUnits: 5_000 },
  ].map((row) => ({
    exchangeCounterpartHoldingId: null,
    untrackedCounterpart: null,
    loanHoldingId: null,
    ...row,
  })),
  currency_rate_history: [
    { base: 'USD', quote: 'UAH', day: toUtcMidnight(now) - 5 * DAY_MS, rate: '40', source: 'nbu' },
  ],
  categories: [],
  price_points: [],
};

const BLOCKS = [
  'statistics-block-line',
  'statistics-block-bar',
  'statistics-block-pie',
  'statistics-block-category',
  'statistics-block-trend',
];

type Placement = { windowWidth: number; sizeClass: 'compact' | 'regular'; paneWidth?: number };

const PANE_910: Placement = { windowWidth: 1366, sizeClass: 'regular', paneWidth: 910 };

const renderAt = ({ windowWidth, sizeClass, paneWidth }: Placement) => {
  mockWindow.width = windowWidth;
  mockSizeClass = sizeClass;

  const inPane = (children: ReactElement) =>
    paneWidth === undefined ? (
      children
    ) : (
      <PaneContext.Provider value={paneContextOf('columns', 'primary')}>
        <PaneWidthContext.Provider value={paneWidth}>{children}</PaneWidthContext.Provider>
      </PaneContext.Provider>
    );

  return render(inPane(<StatisticsScreen />));
};

type View = Awaited<ReturnType<typeof renderAt>>;

const idsOf = (view: View) => testIdsInOrder(view.toJSON());

const countOf = (view: View, testID: string) => idsOf(view).filter((id) => id === testID).length;

const blocksOf = (view: View) => idsOf(view).filter((id) => BLOCKS.includes(id));

const contentStyle = (view: View) =>
  StyleSheet.flatten(view.getByTestId('screen-scroll-view').props.contentContainerStyle);

describe('StatisticsScreen grid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLiveQuery.mockImplementation((_query: unknown, watched: string[]) => ({
      data: tables[watched[0]] ?? [],
      isLoading: false,
      isFresh: true,
    }));
  });

  // The window is wide in two of these on purpose: a pane takes its columns from its own width.
  it.each<[string, Placement]>([
    ['an iPhone window', { windowWidth: 390, sizeClass: 'compact' }],
    [
      'a Duo companion pane (475) in a wide window',
      { windowWidth: 1032, sizeClass: 'compact', paneWidth: 475 },
    ],
    ['a Duo inner-window pane (669)', { windowWidth: 951, sizeClass: 'compact', paneWidth: 669 }],
  ])("keeps today's single column in %s", async (_name, placement) => {
    const view = await renderAt(placement);

    expect(countOf(view, 'statistics-grid-row')).toBe(0);
    expect(countOf(view, 'statistics-grid-spacer')).toBe(0);
    expect(blocksOf(view)).toEqual(BLOCKS);
  });

  it('keeps the pane max-width cap on a Duo pane', async () => {
    const view = await renderAt({ windowWidth: 951, sizeClass: 'compact', paneWidth: 475 });

    expect(contentStyle(view).maxWidth).toBe(darkTheme.layout.paneMaxWidth);
  });

  it('leaves an iPhone window with no cap', async () => {
    const view = await renderAt({ windowWidth: 390, sizeClass: 'compact' });

    expect(contentStyle(view).maxWidth).toBeUndefined();
  });

  it('lays out two columns in a 910 pane, from the pane width and not the wider window', async () => {
    const view = await renderAt(PANE_910);

    expect(countOf(view, 'statistics-grid-row')).toBe(2);
    expect(countOf(view, 'statistics-grid-spacer')).toBe(0);
  });

  it('removes the content cap for the grid in a 910 pane', async () => {
    const view = await renderAt(PANE_910);

    expect(contentStyle(view).maxWidth).toBeUndefined();
  });

  it('puts the filter bar above the grid in a 910 pane', async () => {
    const ids = idsOf(await renderAt(PANE_910));
    const filter = ids.indexOf('statistics-account-filter');

    expect(filter).toBeGreaterThan(-1);
    expect(ids.indexOf('statistics-grid-row')).toBeGreaterThan(-1);
    expect(filter).toBeLessThan(ids.indexOf('statistics-block-line'));
    expect(filter).toBeLessThan(ids.indexOf('statistics-grid-row'));
  });

  it('keeps the net worth over time card first, outside every row, in a 910 pane', async () => {
    const ids = idsOf(await renderAt(PANE_910));

    expect(ids.indexOf('statistics-block-line')).toBeGreaterThan(-1);
    expect(ids.indexOf('statistics-grid-row')).toBeGreaterThan(-1);
    expect(ids.indexOf('statistics-block-line')).toBeLessThan(ids.indexOf('statistics-grid-row'));
  });

  it('renders the five cards in order in a 910 pane', async () => {
    expect(blocksOf(await renderAt(PANE_910))).toEqual(BLOCKS);
  });

  // Not an iPad state (a window this wide is split into panes): it proves the pure path from the
  // window width when no pane applies.
  it('lays out three columns in a 1032 single window (pure-path, not an iPad state)', async () => {
    const view = await renderAt({ windowWidth: 1032, sizeClass: 'regular' });

    expect(countOf(view, 'statistics-grid-row')).toBe(2);
    expect(countOf(view, 'statistics-grid-spacer')).toBe(2);
    expect(blocksOf(view)).toEqual(BLOCKS);
    expect(contentStyle(view).maxWidth).toBeUndefined();
  });

  it('keeps the rows and mounts the net worth card once through a filter toggle and a date range', async () => {
    const view = await renderAt(PANE_910);
    const gridBefore = idsOf(view).filter((id) => id.startsWith('statistics-grid'));

    await act(async () => {
      await fireEvent.press(view.getByTestId('statistics-account-filter'));
    });
    await act(async () => {
      await fireEvent.press(view.getByTestId('statistics-account-filter-option-a'));
    });
    await act(async () => {
      await fireEvent.press(view.getByTestId('statistics-account-filter-backdrop'));
    });
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Date range'));
    });

    const today = new Date(now);

    await act(async () => {
      view.getByTestId('date-range-calendar').props.onDayPress({
        year: today.getFullYear(),
        month: today.getMonth() + 1,
        day: today.getDate(),
      });
    });
    await act(async () => {
      await fireEvent.press(view.getByText('Apply'));
    });

    expect(gridBefore).toHaveLength(2);
    expect(idsOf(view).filter((id) => id.startsWith('statistics-grid'))).toEqual(gridBefore);
    expect(blocksOf(view)).toEqual(BLOCKS);
    expect(mockNetWorthLineMounts).toHaveBeenCalledTimes(1);
  });
});
