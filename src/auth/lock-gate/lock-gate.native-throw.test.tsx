import { authenticateWithOptions } from '@sbaiahmed1/react-native-biometrics';
import { render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus, Text } from 'react-native';
import '../../design-system/unistyles';
import '../../i18n';

import { en } from '../../i18n/locales/en';

import LockGate from './lock-gate.component';

// T-15 regression: proves the fix end to end, through the REAL `useAppLock` +
// REAL `biometrics.authenticate` (only the native module itself is mocked,
// same as `.disabled.test.tsx`'s pattern for the flag-off path). `LockGate`'s
// `unlock().then(setLastResult)` (lock-gate.component.tsx) has no `.catch` by
// design — biometrics.ts's `authenticate` is a TOTAL function that folds a
// native rejection into `{ kind: 'failed', code }` rather than rejecting, so
// this must render the failed hint instead of hanging on the default one with
// an unhandled rejection.
jest.mock('../../db/db-config', () => ({ APP_LOCK_ENABLED: true }));

// Same stand-in as lock-gate.component.test.tsx: the SF Symbol glyph is a
// native SFSymbolView, unavailable under react-test-renderer.
jest.mock('../../design-system/components/symbol', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <RNText>{`icon:${name}`}</RNText>,
  };
});

type SettingsRow = { lockEnabled: boolean };
const mockLiveQuery: { current: { data: SettingsRow[]; isLoading: boolean } } = {
  current: { data: [{ lockEnabled: true }], isLoading: false },
};
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => mockLiveQuery.current,
}));
jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const mockAuthenticateWithOptions = authenticateWithOptions as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_type: string, _listener: (state: AppStateStatus) => void) => ({ remove: jest.fn() }),
  );
  mockLiveQuery.current = { data: [{ lockEnabled: true }], isLoading: false };
});

describe('LockGate with APP_LOCK_ENABLED on and a rejecting native module', () => {
  it('renders the failed hint instead of hanging when the native call rejects', async () => {
    mockAuthenticateWithOptions.mockRejectedValueOnce(new Error('boom'));

    const { getByText } = await render(
      <LockGate>
        <Text>secret balances</Text>
      </LockGate>,
    );

    await waitFor(() => {
      expect(getByText(en.auth.hint.failed)).toBeTruthy();
    });
  });
});
