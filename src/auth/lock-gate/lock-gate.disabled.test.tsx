import { render } from '@testing-library/react-native';
import { AppState, type AppStateStatus, Text } from 'react-native';
import '../../design-system/unistyles';
import '../../i18n';

import LockGate from './lock-gate.component';

// APP_LOCK_ENABLED defaults FALSE. This pins the safety contract at the UI layer,
// with the REAL `useAppLock` (not mocked): with the flag off, LockGate is a pure
// pass-through — it renders its children, never shows the lock prompt, and never
// reaches the native biometrics module. A spy on `./biometrics.authenticate`
// proves it is never called even when the stored setting enables the lock.
jest.mock('../../db/db-config', () => ({ APP_LOCK_ENABLED: false }));

const mockAuthenticate = jest.fn(async (..._args: unknown[]) => ({ kind: 'success' }) as const);
jest.mock('../biometrics', () => ({
  authenticate: (...args: unknown[]) => mockAuthenticate(...args),
}));

type SettingsRow = { lockEnabled: boolean };
const mockLiveQuery: { current: { data: SettingsRow[]; isLoading: boolean } } = {
  current: { data: [], isLoading: false },
};
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => mockLiveQuery.current,
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_type: string, _listener: (state: AppStateStatus) => void) => ({ remove: jest.fn() }),
  );
  mockLiveQuery.current = {
    data: [{ lockEnabled: true }],
    isLoading: false,
  };
});

describe('LockGate with APP_LOCK_ENABLED off', () => {
  it('renders children and never prompts even when the stored setting enables the lock', async () => {
    const { getByText, queryByTestId } = await render(
      <LockGate>
        <Text>secret balances</Text>
      </LockGate>,
    );

    expect(getByText('secret balances')).toBeTruthy();
    expect(queryByTestId('lock-gate')).toBeNull();
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
