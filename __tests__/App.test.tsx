/**
 * @format
 */

import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

// MigrationsGate pulls in the op-sqlite native binding, which has no jest
// binary; stub it to render its children as if migrations already succeeded.
jest.mock('../src/db/migrations-gate', () => ({
  MigrationsGate: ({ children }: { children: ReactNode }) => children,
}));

const mockEnsure = jest.fn(() => Promise.resolve());
jest.mock('../src/repositories/settings.repo', () => ({
  settingsRepo: { ensure: () => mockEnsure() },
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
