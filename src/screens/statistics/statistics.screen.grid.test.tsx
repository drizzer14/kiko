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
// re-laid out on a filter change would unmount and remount it. The real chart stays inside so a
// scrub runs the real gesture.
const mockNetWorthLineMounts = jest.fn();

jest.mock('./net-worth-line', () => {
  const { createElement, useEffect } = jest.requireActual('react');
  const NetWorthLine = jest.requireActual('./net-worth-line').default;

  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      useEffect(() => {
        mockNetWorthLineMounts();
      }, []);

      return createElement(NetWorthLine, props);
    },
  };
});

// A full-width card's mount counter, for the same reason.
const mockBarChartMounts = jest.fn();

jest.mock('./bar-chart', () => {
  const { useEffect } = jest.requireActual('react');

  return {
    __esModule: true,
    default: () => {
      useEffect(() => {
        mockBarChartMounts();
      }, []);

      return null;
    },
  };
});

// The shared row's two cards: the category donut passes its own test id, the account pie none.
const mockPieChartMounts = jest.fn();

jest.mock('./pie-chart', () => {
  const { useEffect } = jest.requireActual('react');

  return {
    __esModule: true,
    default: ({ testID }: { testID?: string }) => {
      useEffect(() => {
        mockPieChartMounts(testID ?? 'account-pie');
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
let mockTabBarEdge: TabBarEdge = 'none';

// `useLayoutMode` is mocked too, from the same window and size class by the real rule: the real
// hook reads the native module through an import this mock cannot reach.
jest.mock('@kiko/display-regions', () => {
  const actual = jest.requireActual('@kiko/display-regions');

  return {
    ...actual,
    useDisplayRegions: () => ({ horizontalSizeClass: mockSizeClass }),
    useLayoutMode: () =>
      actual.resolveLayoutMode(mockSizeClass, mockWindow.width, mockWindow.height),
    useIsLargeWindow: () =>
      actual.isLargeWindow(mockSizeClass, mockWindow.width, mockWindow.height),
    useTabBarEdge: () => mockTabBarEdge,
  };
});

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
import { State } from 'react-native-gesture-handler';
import { darkTheme } from '@kiko/design-system/theme';
import type { TabBarEdge } from '@kiko/display-regions';
import { toUtcMidnight } from '@kiko/rates/history-entry';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import { testIdsInOrder } from '@kiko/test-support/test-ids-in-order';
import { act, fireEvent, render } from '@testing-library/react-native';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { PaneContext, PaneWidthContext, paneContextOf } from '@kiko/design-system/pane-context';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import '@kiko/design-system/unistyles';

import StatisticsScreen from './statistics.screen';

afterEach(resetStatisticsFilterSelection);
import { NET_WORTH_SCRUB_GESTURE_TEST_ID } from './net-worth-line/net-worth-line.component';

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

const FULL_WIDTH_BLOCKS = [
  'statistics-block-line',
  'statistics-block-bar',
  'statistics-block-trend',
];

// The two cards that share one row where the pane is wide enough, and stack otherwise.
const SHARED_BLOCKS = ['statistics-block-category', 'statistics-block-pie'];

// A large window (every full-screen iPad) has room to share a row: the trend moves up and the
// category donut and the account pie close the screen.
const BLOCKS = [...FULL_WIDTH_BLOCKS, ...SHARED_BLOCKS];

// A window that is not large (an iPhone, a Duo folded or unfolded, an iPad compatibility window)
// shows one column, every card full width: the account pie, then the category donut, with the
// trend last.
const SMALL_WINDOW_BLOCKS = [
  'statistics-block-line',
  'statistics-block-bar',
  'statistics-block-pie',
  'statistics-block-category',
  'statistics-block-trend',
];

// The wrapper around the chart of each shared card, the box that centres it vertically.
const CHART_BODIES = ['statistics-chart-body-category', 'statistics-chart-body-pie'];

type Placement = {
  windowWidth: number;
  windowHeight?: number;
  sizeClass: 'compact' | 'regular';
  paneWidth?: number;
  tabBarEdge?: TabBarEdge;
};

// A 13-inch iPad in landscape: half of 1376 is 687.5, wide enough to share the row.
const PANE_SHARED: Placement = {
  windowWidth: 1376,
  windowHeight: 1032,
  sizeClass: 'regular',
  paneWidth: 687.5,
  tabBarEdge: 'top',
};

// An iPad mini in portrait: half of 744 is 371.5, too narrow to share the row.
const PANE_STACKED: Placement = {
  windowWidth: 744,
  windowHeight: 1133,
  sizeClass: 'regular',
  paneWidth: 371.5,
  tabBarEdge: 'top',
};

const IPHONE_HEIGHT = 844;

const renderAt = ({
  windowWidth,
  windowHeight = IPHONE_HEIGHT,
  sizeClass,
  paneWidth,
  tabBarEdge = 'none',
}: Placement) => {
  mockWindow.width = windowWidth;
  mockWindow.height = windowHeight;
  mockSizeClass = sizeClass;
  mockTabBarEdge = tabBarEdge;

  const inPane = (children: ReactElement) =>
    paneWidth === undefined ? (
      children
    ) : (
      <PaneContext.Provider value={paneContextOf('columns', 'primary')}>
        <PaneWidthContext.Provider value={paneWidth}>{children}</PaneWidthContext.Provider>
      </PaneContext.Provider>
    );

  return render(inPane(<StatisticsScreen />), { wrapper: GestureRootWrapper });
};

type View = Awaited<ReturnType<typeof renderAt>>;

const idsOf = (view: View) => testIdsInOrder(view.toJSON());

const countOf = (view: View, testID: string) => idsOf(view).filter((id) => id === testID).length;

const blocksOf = (view: View) => idsOf(view).filter((id) => BLOCKS.includes(id));

const contentStyle = (view: View) =>
  StyleSheet.flatten(view.getByTestId('screen-scroll-view').props.contentContainerStyle);

type RenderedTree = NonNullable<ReturnType<View['toJSON']>>;
type RenderedNode = Exclude<RenderedTree, unknown[]>;

const isNode = (child: RenderedNode | string): child is RenderedNode => typeof child !== 'string';

const nodesWithTestId = (tree: RenderedNode | string, testID: string): RenderedNode[] => {
  if (!isNode(tree)) {
    return [];
  }

  const below = (tree.children ?? []).flatMap((child) => nodesWithTestId(child, testID));

  return tree.props.testID === testID ? [tree, ...below] : below;
};

const hostNodes = (view: View, testID: string) =>
  [view.toJSON()]
    .flat()
    .filter((root) => root !== null)
    .flatMap((root) => nodesWithTestId(root, testID));

// The direct host children of every node with `testID`, as their own testIDs (`undefined` where a
// child carries none), so a stray wrapper view shows up as an extra entry.
const childIdsOf = (view: View, testID: string) =>
  hostNodes(view, testID).map((node) =>
    (node.children ?? []).filter(isNode).map((child) => child.props.testID),
  );

const flexOf = (node: RenderedNode | string) =>
  isNode(node) ? StyleSheet.flatten(node.props.style)?.flex : undefined;

const cardStyleOf = (view: View, testID: string) =>
  StyleSheet.flatten(view.getByTestId(testID).props.style);

// The `flexGrow` of the first host child of a card, the body that holds its title and chart.
const bodyGrowOf = (view: View, testID: string) => {
  const [body] = (hostNodes(view, testID)[0].children ?? []).filter(isNode);

  return StyleSheet.flatten(body.props.style)?.flexGrow;
};

describe('StatisticsScreen grid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLiveQuery.mockImplementation((_query: unknown, watched: string[]) => ({
      data: tables[watched[0]] ?? [],
      isLoading: false,
      isFresh: true,
    }));
  });

  // The window is wide in two of these on purpose: a pane decides to share a row from its own
  // width.
  // The Duo inner window is regular (951x669 landscape, 669x951 portrait), and its panes are the
  // half of it (475) or, in portrait, the whole window width (669).
  it.each<[string, Placement]>([
    ['an iPhone window', { windowWidth: 390, sizeClass: 'compact' }],
    [
      'a Duo companion pane (475) in the landscape inner window',
      { windowWidth: 951, windowHeight: 669, sizeClass: 'regular', paneWidth: 475 },
    ],
    [
      'a Duo inner-window pane (669) in portrait',
      { windowWidth: 669, windowHeight: 951, sizeClass: 'regular', paneWidth: 669 },
    ],
  ])('stacks every card full width, the trend last, in %s', async (_name, placement) => {
    const view = await renderAt(placement);

    expect(countOf(view, 'statistics-grid-row')).toBe(0);
    expect(blocksOf(view)).toEqual(SMALL_WINDOW_BLOCKS);
  });

  it('keeps the pane max-width cap on a Duo pane', async () => {
    const view = await renderAt({
      windowWidth: 951,
      windowHeight: 669,
      sizeClass: 'regular',
      paneWidth: 475,
    });

    expect(contentStyle(view).maxWidth).toBe(darkTheme.layout.paneMaxWidth);
  });

  // Outside a pane the settled mode lags the live one by a settle delay: during an unfold the
  // screen is still the full-window one, with no pane width, in a window the live mode already
  // splits. It keeps its one capped stack until it is in a pane, as `useContentCap` does.
  it.each<[string, Placement, string[]]>([
    [
      'the Duo inner window, landscape (951x669)',
      { windowWidth: 951, windowHeight: 669, sizeClass: 'regular' },
      SMALL_WINDOW_BLOCKS,
    ],
    [
      'the Duo inner window, portrait (669x951)',
      { windowWidth: 669, windowHeight: 951, sizeClass: 'regular' },
      SMALL_WINDOW_BLOCKS,
    ],
    [
      'a 13-inch iPad landscape window (1366x1024)',
      { windowWidth: 1366, windowHeight: 1024, sizeClass: 'regular' },
      BLOCKS,
    ],
    [
      'a 13-inch iPad portrait window (1024x1366)',
      { windowWidth: 1024, windowHeight: 1366, sizeClass: 'regular' },
      BLOCKS,
    ],
  ])(
    'keeps the capped stack in %s while it is still outside a pane',
    async (_name, placement, expectedBlocks) => {
      const view = await renderAt(placement);

      expect(countOf(view, 'statistics-grid-row')).toBe(0);
      expect(blocksOf(view)).toEqual(expectedBlocks);
      expect(contentStyle(view).maxWidth).toBe(darkTheme.layout.paneMaxWidth);
    },
  );

  it('stacks every card, capped, in a regular window too narrow to split (710x500)', async () => {
    const view = await renderAt({ windowWidth: 710, windowHeight: 500, sizeClass: 'regular' });

    expect(countOf(view, 'statistics-grid-row')).toBe(0);
    expect(blocksOf(view)).toEqual(SMALL_WINDOW_BLOCKS);
    expect(contentStyle(view).maxWidth).toBe(darkTheme.layout.paneMaxWidth);
  });

  // The pane is wide enough for a shared row (515.5 is past 480), but the window is not large: the
  // row is shared only on a large window.
  it('stacks every card in a pane of a window that is not large (1032x683, pane 515.5)', async () => {
    const view = await renderAt({
      windowWidth: 1032,
      windowHeight: 683,
      sizeClass: 'regular',
      paneWidth: 515.5,
    });

    expect(countOf(view, 'statistics-grid-row')).toBe(0);
    expect(blocksOf(view)).toEqual(SMALL_WINDOW_BLOCKS);
  });

  it('leaves an iPhone window with no cap', async () => {
    const view = await renderAt({ windowWidth: 390, sizeClass: 'compact' });

    expect(contentStyle(view).maxWidth).toBeUndefined();
  });

  it('stacks every card, with no row, in a large-window pane too narrow to share (371.5)', async () => {
    const view = await renderAt(PANE_STACKED);

    expect(countOf(view, 'statistics-grid-row')).toBe(0);
    expect(blocksOf(view)).toEqual(BLOCKS);
  });

  it('shares one row between the category and account cards in a large-window pane (687.5)', async () => {
    const view = await renderAt(PANE_SHARED);
    const rows = hostNodes(view, 'statistics-grid-row');

    expect(rows.map((row) => BLOCKS.filter((id) => nodesWithTestId(row, id).length > 0))).toEqual([
      SHARED_BLOCKS,
    ]);
  });

  it.each([
    ['a stacked pane', PANE_STACKED],
    ['a shared-row pane', PANE_SHARED],
  ])('leaves %s under a top tab bar uncapped', async (_name, placement) => {
    const view = await renderAt(placement);

    expect(contentStyle(view).maxWidth).toBeUndefined();
  });

  // The pane is 687.5 wide, but a side bar (or a bar not read yet) leaves the content capped at
  // 600, which has no room for two cards: the row follows the content, not the pane.
  it.each([
    ['a leading side bar', 'leading'],
    ['a trailing side bar', 'trailing'],
    ['no bar read', 'none'],
  ] as const)(
    'stacks every card, capped, in a pane of a large window with %s',
    async (_name, tabBarEdge) => {
      const view = await renderAt({ ...PANE_SHARED, tabBarEdge });

      expect(countOf(view, 'statistics-grid-row')).toBe(0);
      expect(blocksOf(view)).toEqual(BLOCKS);
      expect(contentStyle(view).maxWidth).toBe(darkTheme.layout.paneMaxWidth);
    },
  );

  it('puts the filter bar above the cards in a shared-row pane', async () => {
    const ids = idsOf(await renderAt(PANE_SHARED));
    const filter = ids.indexOf('statistics-account-filter');

    expect(filter).toBeGreaterThan(-1);
    expect(filter).toBeLessThan(ids.indexOf('statistics-block-line'));
  });

  it.each([
    ['a stacked pane', PANE_STACKED],
    ['a shared-row pane', PANE_SHARED],
  ])('renders the five cards in order in %s', async (_name, placement) => {
    expect(blocksOf(await renderAt(placement))).toEqual(BLOCKS);
  });

  it('keeps the direct children of the card stack to the filter bar and five cards', async () => {
    const view = await renderAt({ windowWidth: 390, sizeClass: 'compact' });

    // The one `statistics-blocks` host: the filter bar carries no testID of its own.
    expect(childIdsOf(view, 'statistics-blocks')).toEqual([[undefined, ...SMALL_WINDOW_BLOCKS]]);
  });

  it('puts the filter bar, the three full-width cards, then the one shared row in the card stack', async () => {
    const view = await renderAt(PANE_SHARED);

    expect(childIdsOf(view, 'statistics-blocks')).toEqual([
      [undefined, ...FULL_WIDTH_BLOCKS, 'statistics-grid-row'],
    ]);
  });

  it('stretches the two cards of the shared row to the row height', async () => {
    const view = await renderAt(PANE_SHARED);

    expect(SHARED_BLOCKS.map((id) => cardStyleOf(view, id).flexGrow)).toEqual([1, 1]);
  });

  it('centres the chart of each shared card vertically in the room under its title', async () => {
    const view = await renderAt(PANE_SHARED);

    expect(
      CHART_BODIES.map((id) => {
        const { flexGrow, justifyContent } = cardStyleOf(view, id);

        return { flexGrow, justifyContent };
      }),
    ).toEqual([
      { flexGrow: 1, justifyContent: 'center' },
      { flexGrow: 1, justifyContent: 'center' },
    ]);
  });

  it('lets the body of each shared card grow into the row height the chart centres in', async () => {
    const view = await renderAt(PANE_SHARED);

    expect(SHARED_BLOCKS.map((id) => bodyGrowOf(view, id))).toEqual([1, 1]);
  });

  it.each([
    ['a stacked pane', PANE_STACKED],
    ['an iPhone window', { windowWidth: 390, sizeClass: 'compact' } as Placement],
  ])('leaves the chart of each shared card uncentred in %s', async (_name, placement) => {
    const view = await renderAt(placement);

    expect(CHART_BODIES.map((id) => cardStyleOf(view, id).justifyContent)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it.each([
    ['a shared-row pane', PANE_SHARED],
    ['a stacked pane', PANE_STACKED],
    ['an iPhone window', { windowWidth: 390, sizeClass: 'compact' } as Placement],
  ])('leaves the full-width cards at their own height in %s', async (_name, placement) => {
    const view = await renderAt(placement);

    expect(FULL_WIDTH_BLOCKS.map((id) => cardStyleOf(view, id).flexGrow)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it.each([
    ['a stacked pane', PANE_STACKED],
    ['an iPhone window', { windowWidth: 390, sizeClass: 'compact' } as Placement],
  ])('leaves the two shared cards at their own height in %s', async (_name, placement) => {
    const view = await renderAt(placement);

    expect(SHARED_BLOCKS.map((id) => cardStyleOf(view, id).flexGrow)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('gives the two cells of the shared row an equal share of it', async () => {
    const view = await renderAt(PANE_SHARED);
    const rows = hostNodes(view, 'statistics-grid-row');

    expect(rows.map((row) => (row.children ?? []).map(flexOf))).toEqual([[1, 1]]);
  });

  it('keeps the shared row and mounts every card once through a filter toggle and a date range', async () => {
    const view = await renderAt(PANE_SHARED);
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

    expect(gridBefore).toEqual(['statistics-grid-row']);
    expect(idsOf(view).filter((id) => id.startsWith('statistics-grid'))).toEqual(gridBefore);
    expect(blocksOf(view)).toEqual(BLOCKS);
    expect(mockNetWorthLineMounts).toHaveBeenCalledTimes(1);
    expect(mockBarChartMounts).toHaveBeenCalledTimes(1);
    expect(mockPieChartMounts.mock.calls.map(([id]) => id).sort()).toEqual([
      'account-pie',
      'category-pie',
    ]);
  });

  it('keeps the shared row and mounts every card once through a scrub of the net worth line', async () => {
    const view = await renderAt(PANE_SHARED);
    const gridBefore = idsOf(view).filter((id) => id.startsWith('statistics-grid'));
    const layout = (width: number, height: number) => ({
      nativeEvent: { layout: { x: 0, y: 0, width, height } },
    });
    const scrubLineX = () => Number(view.getByTestId('net-worth-line-scrub').props.x1);

    await act(async () => {
      await fireEvent(view.getByTestId('net-worth-line-plot'), 'layout', layout(240, 40));
      await fireEvent(view.getByTestId('net-worth-line-scrub-label'), 'layout', layout(80, 36));
      await fireEvent(view.getByTestId('net-worth-line-scrub-amount'), 'layout', layout(80, 20));
    });
    const restingLineX = scrubLineX();

    await act(async () => {
      fireGestureHandler(getByGestureTestId(NET_WORTH_SCRUB_GESTURE_TEST_ID), [
        { state: State.BEGAN, x: 60 },
        { state: State.ACTIVE, x: 60 },
        { state: State.ACTIVE, x: 120 },
        { state: State.END, x: 120 },
      ]);
    });

    expect(scrubLineX()).not.toBe(restingLineX);
    expect(idsOf(view).filter((id) => id.startsWith('statistics-grid'))).toEqual(gridBefore);
    expect(blocksOf(view)).toEqual(BLOCKS);
    expect(mockNetWorthLineMounts).toHaveBeenCalledTimes(1);
    expect(mockBarChartMounts).toHaveBeenCalledTimes(1);
    expect(mockPieChartMounts).toHaveBeenCalledTimes(2);
  });
});
