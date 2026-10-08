/**
 * @format
 */

import type { ReactNode } from 'react';
import { remindersNative } from '@kiko/reminders/native';
import { navigationRef } from '@kiko/navigation/navigation-ref';
import { act, render, waitFor } from '@testing-library/react-native';

// MigrationsGate pulls in the op-sqlite native binding, which has no jest
// binary; stub it to render its children as if migrations already succeeded.
jest.mock('@kiko/migration/migrations-gate', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

// LockGate reads settings through useLiveQuery; stub it as a passthrough so the
// boot smoke test reaches Home exactly as MigrationsGate is stubbed. A test
// that needs the lock up starts it locked and unlocks it through `mockLock`.
const mockLock: { startsLocked: boolean; unlock: () => void } = {
  startsLocked: false,
  unlock: () => undefined,
};

jest.mock('@kiko/auth/lock-gate/lock-gate.component', () => {
  const { useState } = require('react');

  return {
    __esModule: true,
    default: ({ children }: { children: ReactNode }) => {
      const [isLocked, setLocked] = useState(mockLock.startsLocked);

      mockLock.unlock = () => setLocked(false);

      return isLocked ? null : children;
    },
  };
});

// The real Settings screen (wired into RootNavigator, rendered inside App)
// also pulls in db/client directly (via useLiveQuery), which opens a real
// op-sqlite connection at module load. Stub it the same way every repo test
// does. `ensure` runs from inside MigrationsGate now (stubbed to a
// passthrough above, so it is never reached from here) — that call is
// asserted in migrations.gate.test.tsx instead, not here.
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    // Two consumers read this: the Home screen (initial route), via
    // useLiveQuery (mocked below to ignore its query argument, so the
    // resolved value's shape doesn't matter there), and useAutoSync (wired
    // into AppRoot), which one-shot `await`s this directly and calls
    // `.at(0)` on the result. It must resolve an array like the real
    // Drizzle query builder does — a `toSQL`-shaped stub would make
    // useAutoSync's `.at(0)` throw, silently swallowed, masking a real bug
    // rather than exercising its deliberate "no prior sync" no-op path.
    getQuery: () => Promise.resolve([]),
  },
}));

// useAutoSync (wired into AppRoot) one-shot `await`s this directly. Stub it
// to resolve no connected accounts so the App boot smoke test exercises
// auto-sync's real "not connected" no-op path on purpose, rather than
// passing by accident through an internally swallowed error. `listQuery` is
// left as the real implementation since the Home screen calls it directly
// through the mocked `useLiveQuery` (which ignores its query argument).
jest.mock('@kiko/accounts/accounts.repo', () => {
  const actual = jest.requireActual('@kiko/accounts/accounts.repo');

  return {
    accountsRepo: {
      ...actual.accountsRepo,
      connectedQuery: () => Promise.resolve([]),
    },
  };
});

// useReminderScheduler (wired into AppRoot) one-shot `await`s these directly.
// Stub them to model a user with no reminders and no queued responses, so the
// smoke test exercises the scheduler's real "no reminders" path on purpose
// rather than passing through a swallowed "database not initialized" error.
jest.mock('@kiko/reminders/repo/reminders.repo', () => ({
  remindersRepo: {
    hasAnyQuery: () => Promise.resolve([]),
    recordEngagements: () => Promise.resolve(),
  },
}));

// useLotRecost (wired into AppRoot) runs the one-time lot recost; spied so a
// test can tell when the app root starts it.
const mockRecostStoredLots = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/holdings/lot-recost/lot-recost', () => ({
  recostStoredLots: () => mockRecostStoredLots(),
}));

// The Home screen is data-driven (accounts/holdings/rates/settings via
// useLiveQuery). This boot smoke test only asserts the screen mounts, so stub
// the hook to return empty data rather than opening a real op-sqlite reactive
// subscription.
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [] }),
}));

import App from '../App';

describe('App', () => {
  afterEach(() => {
    mockLock.startsLocked = false;
  });

  it('boots to the Home screen', async () => {
    const { findByText } = await render(<App />);
    expect(await findByText('Home')).toBeTruthy();
  });

  it('re-plans the reminders once the app root mounts', async () => {
    const replaceRequests = jest.spyOn(remindersNative, 'replaceRequests');

    await render(<App />);

    await waitFor(() => expect(replaceRequests).toHaveBeenCalledWith([], []));
  });

  it('costs the stored lots again once the app root mounts, never while locked', async () => {
    mockRecostStoredLots.mockClear();
    mockLock.startsLocked = true;

    await render(<App />);

    expect(mockRecostStoredLots).not.toHaveBeenCalled();

    await act(async () => {
      mockLock.unlock();
    });

    await waitFor(() => expect(mockRecostStoredLots).toHaveBeenCalledTimes(1));
  });

  it('reads no notification tap and has no navigator to route to until the app is unlocked', async () => {
    const drainResponses = jest.spyOn(remindersNative, 'drainResponses');
    mockLock.startsLocked = true;

    await render(<App />);

    expect(drainResponses).not.toHaveBeenCalled();
    expect(navigationRef.isReady()).toBe(false);

    await act(async () => {
      mockLock.unlock();
    });

    await waitFor(() => expect(drainResponses).toHaveBeenCalledTimes(1));
    expect(navigationRef.isReady()).toBe(true);
  });
});
