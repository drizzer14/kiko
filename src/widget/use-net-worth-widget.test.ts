import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

const mockWriteSnapshot = jest.fn(() => Promise.resolve());
const mockReloadWidget = jest.fn();

jest.mock('./widget-bridge', () => ({
  widgetBridge: {
    writeSnapshot: (...args: unknown[]) => mockWriteSnapshot(...args),
    reloadWidget: (...args: unknown[]) => mockReloadWidget(...args),
  },
}));

const mockUseLiveQuery = jest.fn();

jest.mock('../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../repositories/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../repositories/holdings.repo', () => ({
  holdingsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../repositories/rates.repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../repositories/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../repositories/transactions.repo', () => ({
  transactionsRepo: { listAllQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../repositories/rate-history.repo', () => ({
  rateHistoryRepo: { historyRowsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

import { useNetWorthWidget } from './use-net-worth-widget';

type LiveData = {
  accounts?: unknown[];
  holdings?: unknown[];
  rates?: unknown[];
  settings?: unknown[];
  transactions?: unknown[];
  history?: unknown[];
};

// Feed each `useLiveQuery` call by the first table name it watches, mirroring
// `statistics.screen.test.tsx`'s mock shape.
const setLiveData = (data: LiveData): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
    transactions: data.transactions ?? [],
    currency_rate_history: data.history ?? [],
  };
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
  }));
};

const ACCOUNT = { id: 'a1', archivedAt: null };
const HOLDING = {
  id: 'h1',
  accountId: 'a1',
  currency: 'USD',
  type: 'cash',
  balanceMinorUnits: 10_000,
  metadata: null,
  closedAt: null,
};
const RATE = { base: 'USD', quote: 'UAH', rate: '40' };

let appStateListeners: Array<(state: AppStateStatus) => void>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  appStateListeners = [];
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_type: string, listener: (state: AppStateStatus) => void) => {
      appStateListeners.push(listener);

      return { remove: jest.fn() };
    },
  );
  setLiveData({});
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useNetWorthWidget', () => {
  it('writes the snapshot and reloads the widget once, after the debounce window', async () => {
    setLiveData({ accounts: [ACCOUNT], holdings: [HOLDING], rates: [RATE] });
    await renderHook(() => useNetWorthWidget());

    expect(mockWriteSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
    expect(mockReloadWidget).toHaveBeenCalledTimes(1);

    const snapshot = mockWriteSnapshot.mock.calls[0]?.[0];
    expect(snapshot.baseCurrency).toBe('UAH');
    expect(snapshot.total.minorUnits).toBeGreaterThan(0);
  });

  it('writes an empty trend when there are no history rows yet (first run)', async () => {
    setLiveData({ accounts: [ACCOUNT], holdings: [HOLDING], rates: [RATE], history: [] });
    await renderHook(() => useNetWorthWidget());

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    const snapshot = mockWriteSnapshot.mock.calls[0]?.[0];
    expect(snapshot.trend).toEqual([]);
  });

  it('writes immediately when AppState transitions to background, without waiting for the debounce', async () => {
    setLiveData({ accounts: [ACCOUNT], holdings: [HOLDING], rates: [RATE] });
    await renderHook(() => useNetWorthWidget());

    await act(async () => {
      for (const listener of appStateListeners) {
        listener('background');
      }
      await Promise.resolve();
    });

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
  });

  it('clears the debounce timer on unmount, never writing after the window elapses', async () => {
    setLiveData({ accounts: [ACCOUNT], holdings: [HOLDING], rates: [RATE] });
    const { unmount } = await renderHook(() => useNetWorthWidget());

    await unmount();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    expect(mockWriteSnapshot).not.toHaveBeenCalled();
  });

  it('removes the AppState listener on unmount', async () => {
    setLiveData({ accounts: [ACCOUNT], holdings: [HOLDING], rates: [RATE] });
    const { unmount } = await renderHook(() => useNetWorthWidget());
    const removeSpies = (AppState.addEventListener as jest.Mock).mock.results.map(
      (call) => call.value.remove,
    );

    await unmount();

    for (const removeSpy of removeSpies) {
      expect(removeSpy).toHaveBeenCalled();
    }
  });
});
