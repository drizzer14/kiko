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
// The real parser stays, so a stored value reads as the repository reads it; only the queries are
// stubbed.
jest.mock('@kiko/settings', () => {
  const actual = jest.requireActual('@kiko/settings');

  return {
    ...actual,
    settingsRepo: {
      ...actual.settingsRepo,
      getQuery: () => stubQuery,
      recurringMerchantChoicesQuery: () => stubQuery,
    },
  };
});

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
type ReadName = Table | 'settings';

let committed: World;
let pending: World | undefined;
let queued: Set<ReadName>;

// The settings read answers with these rows; an empty list is a database with no settings row.
type SettingsRows = { recurringMerchantChoices: unknown }[];

let settingsRows: SettingsRows;
let pendingSettingsRows: SettingsRows | undefined;

// The tables each read listens to, by its first table, as its latest render gave them. A write to
// a listened table makes that read run again, as the live-query hook does.
let listenedTables: Map<string, string[]>;

// How often the ledger read ran again: a ledger write, or a write to a table it listens to.
let ledgerReruns: number;

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
  settingsRows = [];
  pendingSettingsRows = undefined;
  listenedTables = new Map();
  ledgerReruns = 0;
  mockUseLiveQuery.mockImplementation(
    (_query: unknown, tables: string[], _enabled: boolean, options?: { paused?: boolean }) => {
      const isPaused = options?.paused ?? false;

      listenedTables.set(tables[0], tables);

      if (!isPaused && pending !== undefined) {
        committed = pending;
        pending = undefined;
        ledgerReruns += 1;
      }

      if (tables[0] === 'settings') {
        if (!isPaused && pendingSettingsRows !== undefined) {
          settingsRows = pendingSettingsRows;
          pendingSettingsRows = undefined;

          if (listenedTables.get('transactions')?.includes('settings')) {
            ledgerReruns += 1;
          }
        }

        return { data: settingsRows, isLoading: queued.has('settings'), isFresh: true };
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
  it('reads the ledger, the holdings, the accounts and the settings, each from its own table', async () => {
    await renderHook(() => useRecurringSeries());

    expect(mockUseLiveQuery.mock.calls.map((call) => call[1])).toEqual([
      ['transactions'],
      ['holdings'],
      ['accounts'],
      ['settings'],
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

      expect(mockUseLiveQuery.mock.calls).toHaveLength(4);

      for (const options of optionsOfEveryCall()) {
        expect(options).toStrictEqual({ paused: true });
      }
    });

    it('leaves every read unpaused while the screen is on screen', async () => {
      await renderHook(() => useRecurringSeries());

      expect(mockUseLiveQuery.mock.calls).toHaveLength(4);

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

    it('not at all while a read is still queued, then once when the last one settles', async () => {
      queued = new Set<Table>(['transactions', 'holdings', 'accounts']);
      committed = { transactions: [], holdings: [], accounts: [] };

      const { result, rerender } = await renderHook(() => useRecurringSeries());

      const settle = async (table: Table, rows: World[Table]): Promise<void> => {
        queued.delete(table);
        committed = { ...committed, [table]: rows };
        await setVisible(rerender, true);
      };
      const fullWorld = worldOf(monthlyCharges('Netflix', -41_900));

      await settle('transactions', fullWorld.transactions);
      await settle('holdings', fullWorld.holdings);

      expect(mockDetectRecurringSeries).not.toHaveBeenCalled();
      expect(result.current.series).toEqual([]);

      await settle('accounts', fullWorld.accounts);

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(1);
      expect(names(result.current.series)).toEqual(['Netflix']);
    });

    it('keeps the last rows over a pause: no empty frame, no detection', async () => {
      const shown: string[][] = [];

      const { rerender } = await renderHook(() => {
        const hook = useRecurringSeries();

        shown.push(names(hook.series));

        return hook;
      });

      await setVisible(rerender, false);
      await setVisible(rerender, true);

      expect(shown.every((frame) => frame.join() === 'Netflix')).toBe(true);
      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(1);
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

describe('useRecurringSeries — the merchant choices', () => {
  const NETFLIX_CHOICE = { name: 'Netflix', hidden: true };

  const settingsCalls = (): unknown[][] =>
    mockUseLiveQuery.mock.calls.filter((call) => (call[1] as string[])[0] === 'settings');

  it('reads the settings table, paused with the others and never cached', async () => {
    await renderHook(() => useRecurringSeries());

    expect(mockUseLiveQuery.mock.calls.map((call) => call[1])).toContainEqual(['settings']);
    expect(settingsCalls().map((call) => call[3])).toEqual([{ paused: false }]);
  });

  it('pauses the settings read while the screen is hidden', async () => {
    mockUseIsScreenVisible.mockReturnValue(false);

    await renderHook(() => useRecurringSeries());

    expect(settingsCalls().map((call) => call[3])).toEqual([{ paused: true }]);
  });

  it('reads the stored choices of the settings row by key', async () => {
    settingsRows = [{ recurringMerchantChoices: { netflix: NETFLIX_CHOICE } }];

    const { result } = await renderHook(() => useRecurringSeries());

    expect(result.current.choices.size).toBe(1);
    expect(result.current.choices.get('netflix')).toEqual(NETFLIX_CHOICE);
  });

  it.each([
    { title: 'no settings row', rows: [] },
    { title: 'a row with nothing stored', rows: [{ recurringMerchantChoices: null }] },
  ])('reads no choice from $title, and none under an object property name', async ({ rows }) => {
    settingsRows = rows;

    const { result } = await renderHook(() => useRecurringSeries());

    expect(result.current.choices.size).toBe(0);
    expect(result.current.choices.has('constructor')).toBe(false);
  });

  it('reads a stored __proto__ key as an entry beside a plain one', async () => {
    settingsRows = [
      {
        recurringMerchantChoices: JSON.parse(
          '{"__proto__":{"name":"Proto","hidden":true},"netflix":{"name":"Netflix","hidden":true}}',
        ),
      },
    ];

    const { result } = await renderHook(() => useRecurringSeries());

    expect([...result.current.choices.keys()].sort()).toEqual(['__proto__', 'netflix']);
    expect(result.current.choices.get('__proto__')).toEqual({ name: 'Proto', hidden: true });
  });

  it('keeps a hidden merchant in series, which the list filters', async () => {
    committed = worldOf([
      ...monthlyCharges('Netflix', -41_900),
      ...monthlyCharges('Spotify', -9_900),
    ]);
    settingsRows = [{ recurringMerchantChoices: { netflix: NETFLIX_CHOICE } }];

    const { result } = await renderHook(() => useRecurringSeries());

    expect(names(result.current.series)).toEqual(['Netflix', 'Spotify']);
    expect(result.current.choices.get('netflix')).toEqual(NETFLIX_CHOICE);
  });

  describe('detection and the settings read', () => {
    it('waits for the settings read too, with each other read landed before it, then runs once', async () => {
      queued = new Set<ReadName>(['transactions', 'holdings', 'accounts', 'settings']);
      committed = { transactions: [], holdings: [], accounts: [] };

      const { result, rerender } = await renderHook(() => useRecurringSeries());
      const fullWorld = worldOf(monthlyCharges('Netflix', -41_900));

      const land = async (read: ReadName, apply: () => void): Promise<void> => {
        queued.delete(read);
        apply();
        await setVisible(rerender, true);
      };

      await land('transactions', () => {
        committed = { ...committed, transactions: fullWorld.transactions };
      });
      await land('holdings', () => {
        committed = { ...committed, holdings: fullWorld.holdings };
      });
      await land('accounts', () => {
        committed = { ...committed, accounts: fullWorld.accounts };
      });

      expect(result.current.isLoading).toBe(true);
      expect(mockDetectRecurringSeries).not.toHaveBeenCalled();
      expect(result.current.series).toEqual([]);

      await land('settings', () => {
        settingsRows = [{ recurringMerchantChoices: { netflix: NETFLIX_CHOICE } }];
      });

      expect(result.current.isLoading).toBe(false);
      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(1);
      expect(names(result.current.series)).toEqual(['Netflix']);
      expect(result.current.choices.get('netflix')).toEqual(NETFLIX_CHOICE);
    });

    it('runs nothing and reads no ledger for a settings write, and hands over the same series', async () => {
      const { result, rerender } = await renderHook(() => useRecurringSeries());
      const seriesBefore = result.current.series;

      pendingSettingsRows = [{ recurringMerchantChoices: { netflix: NETFLIX_CHOICE } }];
      await setVisible(rerender, true);

      expect(result.current.choices.get('netflix')).toEqual(NETFLIX_CHOICE);
      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(1);
      expect(ledgerReruns).toBe(0);
      expect(result.current.series).toBe(seriesBefore);
    });

    it('counts a ledger write as a ledger read that ran again', async () => {
      const { rerender } = await renderHook(() => useRecurringSeries());

      pending = worldOf([...committed.transactions, ...monthlyCharges('Spotify', -9_900)]);
      await setVisible(rerender, true);

      expect(ledgerReruns).toBe(1);
    });

    it('runs again for a ledger write beside it, which a settings write does not stand for', async () => {
      const { rerender } = await renderHook(() => useRecurringSeries());

      pendingSettingsRows = [{ recurringMerchantChoices: { netflix: NETFLIX_CHOICE } }];
      await setVisible(rerender, true);

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(1);

      pending = worldOf([...committed.transactions, ...monthlyCharges('Spotify', -9_900)]);
      await setVisible(rerender, true);

      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(2);
    });

    it('shows a settings write made while hidden once the screen is back, running nothing', async () => {
      const { result, rerender } = await renderHook(() => useRecurringSeries());

      await setVisible(rerender, false);
      pendingSettingsRows = [{ recurringMerchantChoices: { netflix: NETFLIX_CHOICE } }];
      await setVisible(rerender, false);

      expect(result.current.choices.size).toBe(0);

      await setVisible(rerender, true);

      expect(result.current.choices.get('netflix')).toEqual(NETFLIX_CHOICE);
      expect(mockDetectRecurringSeries).toHaveBeenCalledTimes(1);
    });
  });
});
