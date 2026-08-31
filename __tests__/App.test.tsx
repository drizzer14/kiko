/**
 * @format
 */

import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

// MigrationsGate pulls in the op-sqlite native binding, which has no jest
// binary; stub it to render its children as if migrations already succeeded.
jest.mock('../src/db/migrations.gate', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

// The real Settings screen (wired into RootNavigator, rendered inside App)
// also pulls in db/client directly (via useLiveQuery), which opens a real
// op-sqlite connection at module load. Stub it the same way every repo test
// does.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

const mockEnsure = jest.fn(() => Promise.resolve());
jest.mock('../src/repositories/settings.repo', () => ({
  settingsRepo: {
    ensure: () => mockEnsure(),
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
jest.mock('../src/repositories/accounts.repo', () => {
  const actual = jest.requireActual('../src/repositories/accounts.repo');
  return {
    accountsRepo: {
      ...actual.accountsRepo,
      connectedQuery: () => Promise.resolve([]),
    },
  };
});

// The Home screen is data-driven (accounts/holdings/rates/settings via
// useLiveQuery). This boot smoke test only asserts the screen mounts, so stub
// the hook to return empty data rather than opening a real op-sqlite reactive
// subscription.
jest.mock('../src/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [] }),
}));

import App from '../App';

describe('App', () => {
  beforeEach(() => {
    mockEnsure.mockClear();
  });

  it('boots to the Home screen', async () => {
    const { findByText } = await render(<App />);
    expect(await findByText('Home')).toBeTruthy();
  });

  it('ensures the settings row exists once migrations succeed', async () => {
    await render(<App />);
    await waitFor(() => expect(mockEnsure).toHaveBeenCalledTimes(1));
  });
});
