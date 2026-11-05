import { act, renderHook } from '@testing-library/react-native';

// Whether the screen is on screen: the hook pauses every read while it is not.
const mockUseIsScreenVisible = jest.fn(() => true);
jest.mock('@kiko/navigation/pane-stack', () => ({
  useIsScreenVisible: () => mockUseIsScreenVisible(),
}));

const mockUseLiveQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

const stubQuery = { toSQL: () => ({ sql: '', params: [] }) };
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: { recurringLedgerQuery: () => stubQuery },
}));
jest.mock('@kiko/holdings/repo', () => ({ holdingsRepo: { allQuery: () => stubQuery } }));
jest.mock('@kiko/accounts', () => ({ accountsRepo: { listQuery: () => stubQuery } }));

const mockDetectRecurringSeries = jest.fn();
jest.mock('@kiko/recurring/detection', () => {
  const actual = jest.requireActual('@kiko/recurring/detection');

  return {
    ...actual,
    detectRecurringSeries: (...args: unknown[]) => mockDetectRecurringSeries(...args),
  };
});

import { startOfLocalDay } from '@kiko/dates';
import type { AccountRow, HoldingRow } from '@kiko/db';
import type { RecurringLedgerRow, detectRecurringSeries } from '@kiko/recurring/detection';

import { useRecurringSeries } from './use-recurring-series';

type Table = 'transactions' | 'holdings' | 'accounts';
type World = {
  transactions: RecurringLedgerRow[];
  holdings: Pick<HoldingRow, 'id' | 'accountId' | 'name' | 'currency' | 'metadata'>[];
  accounts: Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[];
};

const MONTH_COUNT = 6;
const MORNING = new Date(2026, 10, 4, 9, 0).getTime();
const EVENING_OF_THE_SAME_DAY = new Date(2026, 10, 4, 21, 30).getTime();
const NEXT_MORNING = new Date(2026, 10, 5, 8, 0).getTime();

// A merchant charged on the 3rd of each of the six months before the fixed clock.
const monthlyCharges = (description: string, amountMinorUnits: number): RecurringLedgerRow[] =>
  Array.from({ length: MONTH_COUNT }, (_unused, index) => ({
    id: `${description}-${index}`,
    holdingId: 'card',
    amountMinorUnits,
    time: new Date(2026, 9 - index, 3, 10, 30).getTime(),
    description,
    mcc: null,
    counterIban: null,
    categorySetByHand: false,
    setsBalance: false,
    changeGroupId: null,
    exchangePairId: null,
    exchangeCounterpartHoldingId: null,
    untrackedCounterpart: null,
    loanHoldingId: null,
    source: 'monobank',
  }));

const worldOf = (transactions: RecurringLedgerRow[]): World => ({
  transactions,
  holdings: [{ id: 'card', accountId: 'bank', name: 'Card', currency: 'UAH', metadata: null }],
  accounts: [{ id: 'bank', kind: 'bank', archivedAt: null }],
});

const names = (series: { name: string }[]): string[] => series.map((entry) => entry.name).sort();

// What the live-query hook gives a consumer, by its own contract: a call made with `paused: true`
// never applies a pending write, and the first call made unpaused applies it. A table in
// `queued` is a first read that has not settled.
let committed: World;
let pending: World | undefined;
let queued: Set<Table>;

const actualDetection = (
  jest.requireActual('@kiko/recurring/detection') as {
    detectRecurringSeries: typeof detectRecurringSeries;
  }
).detectRecurringSeries;

const optionsOfEveryCall = (): unknown[] => mockUseLiveQuery.mock.calls.map((call) => call[3]);

let clock: number;

beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  clock = MORNING;
  mockUseIsScreenVisible.mockReturnValue(true);
  mockDetectRecurringSeries.mockReset();
  mockDetectRecurringSeries.mockImplementation(actualDetection);
  mockUseLiveQuery.mockReset();
  committed = worldOf([...monthlyCharges('Netflix', -41_900)]);
  pending = undefined;
  queued = new Set();
  mockUseLiveQuery.mockImplementation(
    (_query: unknown, tables: string[], _enabled: boolean, options?: { paused?: boolean }) => {
      if (!(options?.paused ?? false) && pending !== undefined) {
        committed = pending;
        pending = undefined;
      }

      const table = tables[0] as Table;

      return { data: committed[table], isLoading: queued.has(table), isFresh: true };
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

const setVisible = async (
  rerender: (props?: object) => Promise<void> | void,
  isVisible: boolean,
): Promise<void> => {
  mockUseIsScreenVisible.mockReturnValue(isVisible);
  await act(async () => {
    await rerender();
  });
};

describe('useRecurringSeries', () => {
  it('reads the ledger, the holdings and the accounts, each from its own table', async () => {
    await renderHook(() => useRecurringSeries());

    expect(mockUseLiveQuery.mock.calls.map((call) => call[1])).toEqual([
      ['transactions'],
      ['holdings'],
      ['accounts'],
    ]);
  });

  it('detects the series of the live rows, unfiltered', async () => {
    committed = worldOf([
      ...monthlyCharges('Netflix', -41_900),
      ...monthlyCharges('Spotify', -9_900),
    ]);

    const { result } = await renderHook(() => useRecurringSeries());

    expect(names(result.current.series)).toEqual(['Netflix', 'Spotify']);
    expect(result.current.isLoading).toBe(false);
  });

  describe('while the screen is hidden', () => {
    it('pauses every read, and caches none', async () => {
      mockUseIsScreenVisible.mockReturnValue(false);

      await renderHook(() => useRecurringSeries());

      expect(mockUseLiveQuery.mock.calls).toHaveLength(3);

      for (const options of optionsOfEveryCall()) {
        expect(options).toStrictEqual({ paused: true });
      }
    });

    it('leaves every read unpaused while the screen is on screen', async () => {
      await renderHook(() => useRecurringSeries());

      expect(mockUseLiveQuery.mock.calls).toHaveLength(3);

      for (const options of optionsOfEveryCall()) {
        expect(options).toStrictEqual({ paused: false });
      }
    });

    it('shows a write made while hidden once the screen is back, and not before', async () => {
      const { result, rerender } = await renderHook(() => useRecurringSeries());
      expect(names(result.current.series)).toEqual(['Netflix']);

      await setVisible(rerender, false);
      pending = worldOf([...committed.transactions, ...monthlyCharges('Spotify', -9_900)]);
      await setVisible(rerender, false);

      expect(names(result.current.series)).toEqual(['Netflix']);

      await setVisible(rerender, true);

      expect(names(result.current.series)).toEqual(['Netflix', 'Spotify']);
    });

    it('shows a write made while on screen at once', async () => {
      const { result, rerender } = await renderHook(() => useRecurringSeries());

      pending = worldOf([...committed.transactions, ...monthlyCharges('Spotify', -9_900)]);
      await setVisible(rerender, true);

      expect(names(result.current.series)).toEqual(['Netflix', 'Spotify']);
    });
  });

  describe('isLoading', () => {
    it.each<Table>(['transactions', 'holdings', 'accounts'])(
      'is true while the first read of %s is still queued, and no empty list stands for it',
      async (table) => {
        queued = new Set([table]);
        committed = { ...worldOf([]), [table]: [] };

        const { result, rerender } = await renderHook(() => useRecurringSeries());

        expect(result.current.isLoading).toBe(true);
        expect(result.current.series).toEqual([]);

        queued = new Set();
        committed = worldOf(monthlyCharges('Netflix', -41_900));
        await setVisible(rerender, true);

        expect(result.current.isLoading).toBe(false);
        expect(names(result.current.series)).toEqual(['Netflix']);
      },
    );

    it('is true while every read is queued, and false once all have settled', async () => {
      queued = new Set<Table>(['transactions', 'holdings', 'accounts']);

      const { result, rerender } = await renderHook(() => useRecurringSeries());

      expect(result.current.isLoading).toBe(true);

      queued = new Set();
      await setVisible(rerender, true);

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('detection runs', () => {
    it('once on mount, with the start of the local day as now', async () => {
      await renderHook(() => useRecurringSeries());

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(1);
      expect(mockDetectRecurringSeries.mock.calls[0][1]).toBe(startOfLocalDay(MORNING));
      expect(mockDetectRecurringSeries.mock.calls[0][0]).toEqual({
        rows: committed.transactions,
        holdings: committed.holdings,
        accounts: committed.accounts,
      });
    });

    it('once for one fire of the ledger read, and for no re-render after it', async () => {
      const { rerender } = await renderHook(() => useRecurringSeries());

      pending = worldOf([...committed.transactions, ...monthlyCharges('Spotify', -9_900)]);
      await setVisible(rerender, true);

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(2);

      await setVisible(rerender, true);
      await setVisible(rerender, true);

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(2);
    });

    it('not at all for a write made while hidden, until the screen is back, then once', async () => {
      const { rerender } = await renderHook(() => useRecurringSeries());

      await setVisible(rerender, false);
      pending = worldOf([...committed.transactions, ...monthlyCharges('Spotify', -9_900)]);
      await setVisible(rerender, false);

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(1);

      await setVisible(rerender, true);

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(2);
    });

    it('not on a return to the screen on the same local day', async () => {
      const { rerender } = await renderHook(() => useRecurringSeries());

      await setVisible(rerender, false);
      clock = EVENING_OF_THE_SAME_DAY;
      await setVisible(rerender, true);

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(1);
    });

    it('once on a return to the screen on the next local day, with that day as now', async () => {
      const { rerender } = await renderHook(() => useRecurringSeries());

      await setVisible(rerender, false);
      clock = NEXT_MORNING;
      await setVisible(rerender, true);

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(2);
      expect(mockDetectRecurringSeries.mock.calls[1][1]).toBe(startOfLocalDay(NEXT_MORNING));
      expect(mockDetectRecurringSeries.mock.calls[1][1]).not.toBe(
        mockDetectRecurringSeries.mock.calls[0][1],
      );
    });
  });
});
