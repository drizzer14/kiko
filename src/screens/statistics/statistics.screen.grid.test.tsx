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

// A row card's mount counter, for the same reason: the net worth card is the full-width lead, so
// only a card inside a row proves the rows themselves keep their place.
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

// The window and the size class are what a real device reports; each test sets them.
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

let mockSizeClass: 'compact' | 'regular' = 'compact';

// `useLayoutMode` is mocked too, from the same window and size class by the real rule: the real
// hook reads the native module through an import this mock cannot reach.
jest.mock('@kiko/display-regions', () => {
  const actual = jest.requireActual('@kiko/display-regions');

  return {
    ...actual,
    useDisplayRegions: () => ({ horizontalSizeClass: mockSizeClass }),
    useLayoutMode: () =>
      actual.resolveLayoutMode(mockSizeClass, mockWindow.width, mockWindow.height),
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

// The cards that sit in a row at two or more columns: everything but the full-width lead.
const ROW_BLOCKS = BLOCKS.slice(1);

type Placement = {
  windowWidth: number;
  windowHeight?: number;
  sizeClass: 'compact' | 'regular';
  paneWidth?: number;
};

const PANE_910: Placement = {
  windowWidth: 1366,
  windowHeight: 1024,
  sizeClass: 'regular',
  paneWidth: 910,
};

const IPHONE_HEIGHT = 844;

const renderAt = ({
  windowWidth,
  windowHeight = IPHONE_HEIGHT,
  sizeClass,
  paneWidth,
}: Placement) => {
  mockWindow.width = windowWidth;
  mockWindow.height = windowHeight;
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
  ])("keeps today's single column in %s", async (_name, placement) => {
    const view = await renderAt(placement);

    expect(countOf(view, 'statistics-grid-row')).toBe(0);
    expect(countOf(view, 'statistics-grid-spacer')).toBe(0);
    expect(blocksOf(view)).toEqual(BLOCKS);
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
  // splits. It keeps its one capped column until it is in a pane, as `useContentCap` does.
  it.each<[string, Placement]>([
    [
      'the Duo inner window, landscape (951x669)',
      { windowWidth: 951, windowHeight: 669, sizeClass: 'regular' },
    ],
    [
      'the Duo inner window, portrait (669x951)',
      { windowWidth: 669, windowHeight: 951, sizeClass: 'regular' },
    ],
    [
      'a 13-inch iPad landscape window (1366x1024)',
      { windowWidth: 1366, windowHeight: 1024, sizeClass: 'regular' },
    ],
    [
      'a 13-inch iPad portrait window (1024x1366)',
      { windowWidth: 1024, windowHeight: 1366, sizeClass: 'regular' },
    ],
  ])('keeps one capped column in %s while it is still outside a pane', async (_name, placement) => {
    const view = await renderAt(placement);

    expect(countOf(view, 'statistics-grid-row')).toBe(0);
    expect(countOf(view, 'statistics-grid-spacer')).toBe(0);
    expect(blocksOf(view)).toEqual(BLOCKS);
    expect(contentStyle(view).maxWidth).toBe(darkTheme.layout.paneMaxWidth);
  });

  it('lays out two columns in a regular window too narrow to split (710x500)', async () => {
    const view = await renderAt({ windowWidth: 710, windowHeight: 500, sizeClass: 'regular' });

    expect(countOf(view, 'statistics-grid-row')).toBe(2);
    expect(countOf(view, 'statistics-grid-spacer')).toBe(0);
    expect(contentStyle(view).maxWidth).toBeUndefined();
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

  // Not a real state (no window this wide is `single`: a regular one is split and a compact one
  // is a phone): it proves the pure path from the window width when no pane applies.
  it('lays out three columns in a 1032 single window (pure-path, not an iPad state)', async () => {
    const view = await renderAt({ windowWidth: 1032, sizeClass: 'compact' });

    expect(countOf(view, 'statistics-grid-row')).toBe(2);
    expect(countOf(view, 'statistics-grid-spacer')).toBe(2);
    expect(blocksOf(view)).toEqual(BLOCKS);
    expect(contentStyle(view).maxWidth).toBeUndefined();
  });

  it('lays out three columns in a 1032 pane, from the pane width (pure-path)', async () => {
    const view = await renderAt({
      windowWidth: 1366,
      windowHeight: 1024,
      sizeClass: 'regular',
      paneWidth: 1032,
    });

    expect(countOf(view, 'statistics-grid-row')).toBe(2);
    expect(countOf(view, 'statistics-grid-spacer')).toBe(2);
    expect(contentStyle(view).maxWidth).toBeUndefined();
  });

  it('keeps the direct children of the card stack at one column to the filter bar and five cards', async () => {
    const view = await renderAt({ windowWidth: 390, sizeClass: 'compact' });

    // The one `statistics-blocks` host: the filter bar carries no testID of its own.
    expect(childIdsOf(view, 'statistics-blocks')).toEqual([[undefined, ...BLOCKS]]);
  });

  it('stretches a row card to its cell at two columns', async () => {
    const view = await renderAt(PANE_910);

    expect(ROW_BLOCKS.map((id) => cardStyleOf(view, id).flexGrow)).toEqual([1, 1, 1, 1]);
  });

  it('leaves a card at its own height at one column', async () => {
    const view = await renderAt({ windowWidth: 390, sizeClass: 'compact' });

    expect(ROW_BLOCKS.map((id) => cardStyleOf(view, id).flexGrow)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('gives every cell of a row, a spacer included, an equal share of the row', async () => {
    const view = await renderAt({
      windowWidth: 1366,
      windowHeight: 1024,
      sizeClass: 'regular',
      paneWidth: 1032,
    });
    const rows = hostNodes(view, 'statistics-grid-row');

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => (row.children ?? []).map(flexOf))).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ]);
  });

  it('keeps the rows and mounts the net worth card and a row card once through a filter toggle and a date range', async () => {
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
    expect(mockBarChartMounts).toHaveBeenCalledTimes(1);
  });
});
