import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import '../i18n';

import { useAppLock } from './use-app-lock';

// APP_LOCK_ENABLED defaults FALSE. This file pins the safety contract: with the
// flag off, the lock is fully inert and NOTHING reaches the native biometrics
// module. A spy on `./biometrics.authenticate` proves it is never called; the
// module itself is never even imported at runtime because `use-app-lock` only
// `import type`s from it (erased) and defers the real import behind the flag.
jest.mock('../db/db-config', () => ({ APP_LOCK_ENABLED: false }));

const mockAuthenticate = jest.fn(async (..._args: unknown[]) => ({ kind: 'success' }) as const);
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
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const appStateListeners: Array<(state: AppStateStatus) => void> = [];

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
  mockLiveQuery.current = { data: [], isLoading: true };
});

describe('useAppLock with APP_LOCK_ENABLED off', () => {
  it('is ready and unlocked immediately, even before settings load', async () => {
    const { result } = await renderHook(() => useAppLock());

    expect(result.current.isReady).toBe(true);
    expect(result.current.isLocked).toBe(false);
  });

  it('stays unlocked even when the stored setting says the lock is enabled', async () => {
    mockLiveQuery.current = {
      data: [{ lockEnabled: true }],
      isLoading: false,
    };
    const { result } = await renderHook(() => useAppLock());

    expect(result.current.isLocked).toBe(false);

    for (const listener of appStateListeners) {
      listener('background');
    }
    for (const listener of appStateListeners) {
      listener('active');
    }

    expect(result.current.isLocked).toBe(false);
  });

  it('unlock() resolves success without ever calling the biometrics module', async () => {
    mockLiveQuery.current = {
      data: [{ lockEnabled: true }],
      isLoading: false,
    };
    const { result } = await renderHook(() => useAppLock());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.unlock();
    });

    expect(outcome).toEqual({ kind: 'success' });
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
