/**
 * @format
 */

import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

// Same boot-smoke stubs as App.test.tsx — see that file's comments for why
// each one exists (MigrationsGate/LockGate native deps, the settings/accounts
// repos' op-sqlite reads, useLiveQuery).
jest.mock('../src/migration/migrations-gate', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../src/auth/lock-gate/lock-gate.component', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => Promise.resolve([]) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => {
  const actual = jest.requireActual('@kiko/accounts/accounts.repo');
  return {
    accountsRepo: { ...actual.accountsRepo, connectedQuery: () => Promise.resolve([]) },
  };
});
jest.mock('../src/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [] }),
}));

// Mocked at the SAME resolved path both App.tsx (relative) and GlassSurface
// (the `@kiko/*` alias) import through, so both consumers see this one mock.
// `isStableGlassCapture` is passed through unmocked (always `false`) since
// this file only drives the `isUiTestCapture` gate.
const mockIsUiTestCapture = jest.fn();
jest.mock('../src/test-support/ui-test-capture', () => ({
  isUiTestCapture: () => mockIsUiTestCapture(),
  isStableGlassCapture: () => false,
}));

// The global Jest reanimated stub (`jest/reanimated-mock.js`) resolves any
// export it does not explicitly list — including `ReducedMotionConfig` — to a
// no-op FUNCTION, not a component that renders null, so mounting it under
// `<ReducedMotionConfig .../>` throws ("Nothing was returned from render").
// This file-local override delegates every other export to the real shared
// mock (so the rest of the boot tree — grid/scroll hooks — is unaffected) and
// adds a real, render-safe `ReducedMotionConfig` plus a `ReduceMotion` enum
// stand-in, wired to a spy so the test can assert whether it mounted.
const mockReducedMotionConfig = jest.fn();
jest.mock('react-native-reanimated', () => {
  const sharedMock = jest.requireActual('../jest/reanimated-mock');

  return new Proxy(sharedMock, {
    get: (target, prop) => {
      if (prop === 'ReduceMotion') {
        return { Always: 'always' };
      }

      if (prop === 'ReducedMotionConfig') {
        return (props: unknown) => {
          mockReducedMotionConfig(props);
          return null;
        };
      }

      return target[prop as keyof typeof target];
    },
  });
});

import App from '../App';

describe('App reduced-motion capture gate', () => {
  beforeEach(() => {
    mockIsUiTestCapture.mockReset();
    mockReducedMotionConfig.mockClear();
  });

  it('never forces reduced motion on a normal launch (isUiTestCapture false)', async () => {
    mockIsUiTestCapture.mockReturnValue(false);

    await render(<App />);

    expect(mockReducedMotionConfig).not.toHaveBeenCalled();
  });

  it('forces reduced motion Always when launched for UI-test capture (isUiTestCapture true)', async () => {
    mockIsUiTestCapture.mockReturnValue(true);

    await render(<App />);

    expect(mockReducedMotionConfig).toHaveBeenCalledWith({ mode: 'always' });
  });
});
