import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

const mockWriteSnapshot = jest.fn(() => Promise.resolve());
const mockClearSnapshot = jest.fn(() => Promise.resolve());
const mockReloadWidget = jest.fn();

jest.mock('./widget-bridge', () => ({
  widgetBridge: {
    writeSnapshot: (...args: unknown[]) => mockWriteSnapshot(...args),
    clearSnapshot: (...args: unknown[]) => mockClearSnapshot(...args),
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

import { useNetWorthWidget } from './use-net-worth-widget';

type LiveData = {
  accounts?: unknown[];
  holdings?: unknown[];
  rates?: unknown[];
  settings?: unknown[];
};

// Feed each `useLiveQuery` call by the first table name it watches, mirroring
// `statistics.screen.test.tsx`'s mock shape.
const setLiveData = (data: LiveData): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
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
const FULL_LIVE_DATA = { accounts: [ACCOUNT], holdings: [HOLDING], rates: [RATE] };
// Mirrors the hook's own DEBOUNCE_MS.
const DEBOUNCE_MS = 500;

// Renders the hook over the full live data set, with the `settings` rows as the
// only variable: a row whose `lockEnabled` decides the lock behaviour, or `[]`
// for a device with no settings row written yet. Omit it for the default row.
const renderWidget = async (settings?: LiveData['settings']) => {
  setLiveData({ ...FULL_LIVE_DATA, settings });

  return renderHook(() => useNetWorthWidget());
};

const advanceDebounce = async (): Promise<void> => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS);
  });
};

const backgroundApp = async (): Promise<void> => {
  await act(async () => {
    for (const listener of appStateListeners) {
      listener('background');
    }
    await Promise.resolve();
  });
};

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
    await renderWidget();

    expect(mockWriteSnapshot).not.toHaveBeenCalled();

    await advanceDebounce();

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
    expect(mockReloadWidget).toHaveBeenCalledTimes(1);

    const snapshot = mockWriteSnapshot.mock.calls[0]?.[0];
    expect(snapshot.baseCurrency).toBe('UAH');
    expect(snapshot.total.minorUnits).toBeGreaterThan(0);
  });

  it('writes immediately when AppState transitions to background, without waiting for the debounce', async () => {
    await renderWidget();

    await backgroundApp();

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
  });

  it('clears the debounce timer on unmount, never writing after the window elapses', async () => {
    const { unmount } = await renderWidget();

    await unmount();

    await advanceDebounce();

    expect(mockWriteSnapshot).not.toHaveBeenCalled();
  });

  it('removes the AppState listener on unmount', async () => {
    const { unmount } = await renderWidget();
    const removeSpies = (AppState.addEventListener as jest.Mock).mock.results.map(
      (call) => call.value.remove,
    );

    await unmount();

    for (const removeSpy of removeSpies) {
      expect(removeSpy).toHaveBeenCalled();
    }
  });

  it('clears the snapshot instead of writing it while the app lock is enabled', async () => {
    await renderWidget([{ baseCurrency: 'UAH', lockEnabled: true }]);

    await advanceDebounce();

    expect(mockClearSnapshot).toHaveBeenCalledTimes(1);
    expect(mockWriteSnapshot).not.toHaveBeenCalled();
    expect(mockReloadWidget).toHaveBeenCalledTimes(1);
  });

  it('clears the snapshot immediately on background while the app lock is enabled', async () => {
    await renderWidget([{ baseCurrency: 'UAH', lockEnabled: true }]);

    await backgroundApp();

    expect(mockClearSnapshot).toHaveBeenCalledTimes(1);
    expect(mockWriteSnapshot).not.toHaveBeenCalled();
  });

  it('writes the snapshot again once the app lock is disabled', async () => {
    await renderWidget([{ baseCurrency: 'UAH', lockEnabled: false }]);

    await advanceDebounce();

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
    expect(mockClearSnapshot).not.toHaveBeenCalled();
  });

  it('writes the snapshot when no settings row exists yet: a missing row is not a lock', async () => {
    await renderWidget([]);

    await advanceDebounce();

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
    expect(mockClearSnapshot).not.toHaveBeenCalled();
  });
});
