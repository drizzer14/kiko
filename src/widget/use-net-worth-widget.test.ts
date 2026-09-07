import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { i18n } from '../i18n';
import { en } from '../i18n/locales/en';
import { uk } from '../i18n/locales/uk';

import type { NetWorthSnapshot } from './net-worth-snapshot';

const mockWriteSnapshot = jest.fn((_snapshot: NetWorthSnapshot) => Promise.resolve());
const mockClearSnapshot = jest.fn(() => Promise.resolve());
const mockReloadWidget = jest.fn();

jest.mock('./widget-bridge', () => ({
  widgetBridge: {
    writeSnapshot: (...args: Parameters<typeof mockWriteSnapshot>) => mockWriteSnapshot(...args),
    clearSnapshot: () => mockClearSnapshot(),
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

// The snapshot handed to the bridge on its Nth write. Throws instead of
// returning undefined so a missing call fails HERE, naming the write that never
// happened, rather than as a property read on undefined further down.
const writtenSnapshot = (index = 0): NetWorthSnapshot => {
  const call = mockWriteSnapshot.mock.calls[index];

  if (call === undefined) {
    throw new Error(`widgetBridge.writeSnapshot was not called ${index + 1} time(s).`);
  }

  return call[0];
};

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

    const snapshot = writtenSnapshot();
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

  it('re-writes the snapshot when only the language changes', async () => {
    // Stable references across both `setLiveData` calls below, so the only
    // thing that actually changes between renders is `settings.language` —
    // otherwise a fresh `[ACCOUNT]` array literal on the second call would
    // itself change identity and mask what this test is isolating.
    const accountsData = [ACCOUNT];
    const holdingsData = [HOLDING];
    const ratesData = [RATE];

    setLiveData({
      accounts: accountsData,
      holdings: holdingsData,
      rates: ratesData,
      settings: [{ baseCurrency: 'UAH', language: 'en' }],
    });
    await i18n.changeLanguage('en');
    const { rerender } = await renderHook(() => useNetWorthWidget());

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
    expect(writtenSnapshot(0).labels.title).toBe(en.home.netWorth);

    // Only `settings.language` changes — no other table, and `baseCurrency`
    // is untouched — mirroring a user switching language in Settings.
    setLiveData({
      accounts: accountsData,
      holdings: holdingsData,
      rates: ratesData,
      settings: [{ baseCurrency: 'UAH', language: 'uk' }],
    });
    await i18n.changeLanguage('uk');
    // `rerender` (RNTL 14) is itself async, mirroring
    // `use-scroll-to-top-on-tab-press.test.tsx`'s `setup` helper — awaiting it
    // outside `act` leaves a dangling act scope that corrupts every render in
    // the tests that follow.
    await act(async () => {
      await rerender(undefined);
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(2);
    expect(writtenSnapshot(1).labels.title).toBe(uk.home.netWorth);
  });

  it('does not re-write when nothing changes', async () => {
    setLiveData({ accounts: [ACCOUNT], holdings: [HOLDING], rates: [RATE] });
    const { rerender } = await renderHook(() => useNetWorthWidget());

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await rerender(undefined);
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    expect(mockWriteSnapshot).toHaveBeenCalledTimes(1);
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
