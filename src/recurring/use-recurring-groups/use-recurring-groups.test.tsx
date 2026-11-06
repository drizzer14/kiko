import { act, renderHook } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';

// Whether the screen is on screen: the hook pauses every read while it is not.
const mockUseIsScreenVisible = jest.fn(() => true);
jest.mock('@kiko/navigation/pane-stack', () => ({
  useIsScreenVisible: () => mockUseIsScreenVisible(),
}));

type LiveCall = [
  query: { toSQL: () => { sql: string; params: unknown[] } },
  tables: string[],
  enabled: boolean,
  options: unknown,
];

const mockUseLiveQuery = jest.fn<unknown, LiveCall>();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: LiveCall) => mockUseLiveQuery(...args),
}));

// Each stub query reports its own name as its sql and its bound parameters, so a recorded call
// shows the key (`sql::params`) the real live-query hook would read under.
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listWithContextByIdsQuery: (ids: readonly string[]) => ({
      toSQL: () => ({ sql: 'by-ids', params: [JSON.stringify(ids)] }),
    }),
  },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: 'categories', params: [] }) }) },
}));
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: 'rates', params: [] }) }) },
}));
jest.mock('@kiko/settings', () => {
  const actual = jest.requireActual('@kiko/settings');

  return {
    ...actual,
    settingsRepo: {
      ...actual.settingsRepo,
      getQuery: () => ({ toSQL: () => ({ sql: 'settings', params: [] }) }),
    },
  };
});

import type { RecurringSeries } from '@kiko/recurring/detection';

import { useRecurringGroups } from './use-recurring-groups';

type ReadName = 'by-ids' | 'categories' | 'rates' | 'settings';

type Props = { shown: RecurringSeries[]; all: RecurringSeries[] };

const READS: ReadName[] = ['by-ids', 'categories', 'rates', 'settings'];

const seriesOf = (id: string, overrides: Partial<RecurringSeries> = {}): RecurringSeries => ({
  id,
  merchantKey: id,
  name: id,
  currency: 'UAH',
  period: 'monthly',
  recurrence: { kind: 'none' },
  chargeIds: [`${id}-charge`],
  lastChargeTime: 1_000,
  lastChargeAmountMinorUnits: 0,
  lastChargeHoldingId: 'card',
  isStopped: false,
  quiet: null,
  ...overrides,
});

const NETFLIX = seriesOf('netflix', { chargeIds: ['b3', 'b1'] });
const SPOTIFY = seriesOf('spotify', { chargeIds: ['a2', 'b1'], currency: 'USD' });
const ICLOUD = seriesOf('icloud', { chargeIds: ['c0'] });
const NEW_MARK = seriesOf('gym', { chargeIds: ['d9'] });

// A row id two series both hold is one id in the read.
const SORTED_IDS = ['a2', 'b1', 'b3', 'c0'];

const ROWS = [
  { id: 'b3', amountMinorUnits: -5_000, currency: 'UAH', category: 'media' },
  { id: 'b1', amountMinorUnits: -5_000, currency: 'UAH', category: 'media' },
  { id: 'a2', amountMinorUnits: -1, currency: 'USD', category: 'media' },
  { id: 'c0', amountMinorUnits: -700, currency: 'UAH', category: null },
];

let queued: Set<ReadName>;
let rowsOf: Record<ReadName, unknown[]>;

beforeEach(() => {
  mockUseIsScreenVisible.mockReturnValue(true);
  queued = new Set();
  rowsOf = {
    'by-ids': ROWS,
    categories: [
      { key: 'media', title: 'Media', icon: 'tv', color: null },
      { key: 'general', title: 'General', icon: 'star', color: null },
    ],
    rates: [{ base: 'USD', quote: 'UAH', rate: '40.4' }],
    settings: [{ baseCurrency: 'UAH', defaultCategoryKey: 'general' }],
  };
  mockUseLiveQuery.mockReset();
  mockUseLiveQuery.mockImplementation((query) => {
    const name = query.toSQL().sql as ReadName;

    return { data: rowsOf[name], isLoading: queued.has(name), isFresh: true };
  });
});

const callsOf = (name: ReadName): LiveCall[] =>
  mockUseLiveQuery.mock.calls.filter((call) => call[0].toSQL().sql === name);

const byIdsKeys = (): Set<string> =>
  new Set(
    callsOf('by-ids').map((call) => {
      const { sql, params } = call[0].toSQL();

      return `${sql}::${JSON.stringify(params)}`;
    }),
  );

const renderGroups = (initialProps: Props) =>
  renderHook(({ shown, all }: Props) => useRecurringGroups(shown, all), { initialProps });

describe('useRecurringGroups reads', () => {
  it('the by-ids rows, the categories, the rates and the settings, each from its own tables', async () => {
    await renderGroups({ shown: [NETFLIX], all: [NETFLIX] });

    const tablesOf = (name: ReadName): unknown => callsOf(name)[0]?.[1];

    expect(tablesOf('by-ids')).toEqual(['transactions', 'holdings', 'accounts']);
    expect(tablesOf('categories')).toEqual(['categories']);
    expect(tablesOf('rates')).toEqual(['currency_rates']);
    expect(tablesOf('settings')).toEqual(['settings']);
  });

  it('leave every read unpaused and uncached while the screen is on screen', async () => {
    await renderGroups({ shown: [NETFLIX], all: [NETFLIX] });

    expect(mockUseLiveQuery.mock.calls.length).toBeGreaterThanOrEqual(READS.length);

    for (const call of mockUseLiveQuery.mock.calls) {
      expect(call[3]).toStrictEqual({ paused: false });
    }
  });

  it('pause every read while the screen is hidden', async () => {
    mockUseIsScreenVisible.mockReturnValue(false);

    await renderGroups({ shown: [NETFLIX], all: [NETFLIX] });

    for (const name of READS) {
      expect(callsOf(name).length).toBeGreaterThan(0);

      for (const call of callsOf(name)) {
        expect(call[3]).toStrictEqual({ paused: true });
      }
    }
  });
});

describe('the id list of the by-ids read', () => {
  const ORDERS: [string, RecurringSeries[]][] = [
    ['netflix, spotify, icloud', [NETFLIX, SPOTIFY, ICLOUD]],
    ['icloud, netflix, spotify', [ICLOUD, NETFLIX, SPOTIFY]],
    ['spotify, icloud, netflix', [SPOTIFY, ICLOUD, NETFLIX]],
    ['icloud, spotify, netflix', [ICLOUD, SPOTIFY, NETFLIX]],
  ];

  it.each(ORDERS)('is unique and sorted for the series order %s', async (_name, all) => {
    await renderGroups({ shown: all, all });

    expect([...byIdsKeys()]).toEqual([`by-ids::${JSON.stringify([JSON.stringify(SORTED_IDS)])}`]);
  });

  it('holds the ids of every series, including one a hide leaves out of the shown ones', async () => {
    await renderGroups({ shown: [NETFLIX], all: [NETFLIX, SPOTIFY, ICLOUD] });

    expect([...byIdsKeys()]).toEqual([`by-ids::${JSON.stringify([JSON.stringify(SORTED_IDS)])}`]);
  });

  it('adds no by-ids key for a hide, which changes the shown series and no id', async () => {
    const all = [NETFLIX, SPOTIFY, ICLOUD];
    const { rerender } = await renderGroups({ shown: all, all });

    expect(byIdsKeys().size).toBe(1);

    await act(async () => {
      await rerender({ shown: [NETFLIX, ICLOUD], all });
    });

    expect(byIdsKeys().size).toBe(1);
  });

  it('adds exactly one by-ids key for a mark that changes the marked series', async () => {
    const all = [NETFLIX, SPOTIFY, ICLOUD];
    const { rerender } = await renderGroups({ shown: all, all });

    await act(async () => {
      await rerender({ shown: [...all, NEW_MARK], all: [...all, NEW_MARK] });
    });

    expect(byIdsKeys().size).toBe(2);
    expect(byIdsKeys()).toContain(
      `by-ids::${JSON.stringify([JSON.stringify(['a2', 'b1', 'b3', 'c0', 'd9'])])}`,
    );
  });
});

describe('the groups the hook hands over', () => {
  it('group the by-ids rows by the categories read, convert at the rates read, total in the base', async () => {
    const all = [NETFLIX, SPOTIFY, ICLOUD];

    const { result } = await renderGroups({ shown: all, all });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.groups.map((group) => group.key)).toEqual(['media', 'general']);
    expect(result.current.groups.map((group) => group.total.minorUnits)).toEqual([
      10_000 + 40,
      700,
    ]);
    expect(result.current.total).toEqual({ currency: 'UAH', minorUnits: 10_740 });
  });
});

describe('isLoading', () => {
  it.each(READS)(
    'is true, with no group, while %s is the last read still to settle, the others settled one at a time',
    async (last) => {
      const all = [NETFLIX, SPOTIFY, ICLOUD];

      queued = new Set(READS);

      const { result, rerender } = await renderGroups({ shown: all, all });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.groups).toEqual([]);

      for (const name of READS.filter((read) => read !== last)) {
        queued.delete(name);
        await act(async () => {
          await rerender({ shown: all, all });
        });

        expect(result.current.isLoading).toBe(true);
        expect(result.current.groups).toEqual([]);
      }

      queued.delete(last);
      await act(async () => {
        await rerender({ shown: all, all });
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.groups.length).toBeGreaterThan(0);
    },
  );
});
