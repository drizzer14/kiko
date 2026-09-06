import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import '../i18n';

import { useAppLock } from './use-app-lock';

// The whole lock is gated OFF by default (`APP_LOCK_ENABLED`, src/db/db-config).
// These tests exercise the locking LOGIC, so they run with the flag forced ON.
// The OFF path (flag defaulted false) is covered by use-app-lock.disabled.test.ts.
jest.mock('../db/db-config', () => ({ APP_LOCK_ENABLED: true }));

const mockAuthenticate = jest.fn();
jest.mock('./biometrics', () => ({
  authenticate: (...args: unknown[]) => mockAuthenticate(...args),
}));

type SettingsRow = { lockEnabled: boolean };
const mockLiveQuery: { current: { data: SettingsRow[]; isLoading: boolean } } = {
  current: { data: [], isLoading: true },
};
jest.mock('../db/use-live-query', () => ({
  useLiveQuery: () => mockLiveQuery.current,
}));
jest.mock('../repositories/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const appStateListeners: Array<(state: AppStateStatus) => void> = [];

const settled = (lockEnabled: boolean): void => {
  mockLiveQuery.current = { data: [{ lockEnabled }], isLoading: false };
};

// Fire any AppState listeners the hook may have registered. After the re-lock
// path was removed the hook registers none, so this is a no-op that proves a
// background/foreground cycle cannot re-lock an already-unlocked process.
const transition = async (state: AppStateStatus): Promise<void> => {
  await act(async () => {
    for (const listener of appStateListeners) {
      listener(state);
    }
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  appStateListeners.length = 0;
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_type: string, listener: (state: AppStateStatus) => void) => {
      appStateListeners.push(listener);

      return { remove: jest.fn() };
    },
  );
  mockAuthenticate.mockResolvedValue({ kind: 'success' });
  mockLiveQuery.current = { data: [], isLoading: true };
});

describe('useAppLock', () => {
  it('is not ready and not locked while the settings row is still loading', async () => {
    const { result } = await renderHook(() => useAppLock());

    expect(result.current.isReady).toBe(false);
    expect(result.current.isLocked).toBe(false);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('cold launch with the lock disabled never locks', async () => {
    settled(false);
    const { result } = await renderHook(() => useAppLock());

    expect(result.current.isReady).toBe(true);
    expect(result.current.isLocked).toBe(false);
  });

  it('cold launch with the lock enabled starts locked, and a successful unlock clears it', async () => {
    settled(true);
    const { result } = await renderHook(() => useAppLock());

    expect(result.current.isLocked).toBe(true);

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockAuthenticate).toHaveBeenCalledWith('Unlock Kiko');
    expect(result.current.isLocked).toBe(false);
  });

  it('stays locked when authentication does not succeed', async () => {
    settled(true);
    mockAuthenticate.mockResolvedValue({ kind: 'cancelled' });
    const { result } = await renderHook(() => useAppLock());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.unlock();
    });

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(result.current.isLocked).toBe(true);
  });

  it('never registers an AppState listener — the lock is decided once, at cold launch', async () => {
    settled(true);
    await renderHook(() => useAppLock());

    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });

  it('once unlocked, a background→foreground cycle never re-locks, however long the background', async () => {
    settled(true);
    const { result } = await renderHook(() => useAppLock());
    await act(async () => {
      await result.current.unlock();
    });

    expect(result.current.isLocked).toBe(false);

    await transition('background');
    await transition('active');

    expect(result.current.isLocked).toBe(false);
  });
});
