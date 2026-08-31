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
    // The Home screen (initial route) reads settings via useLiveQuery, so its
    // getQuery must be callable when the argument is evaluated.
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

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
