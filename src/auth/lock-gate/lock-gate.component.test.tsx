import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import '../../design-system/unistyles';
import '../../i18n';

import MigrationsGate from '@kiko/migration/migrations.gate';

import LockGate from './lock-gate.component';

// The SF Symbol glyph is a native SFSymbolView; render it as a plain text node
// so the lock screen's icon name is queryable without the native module (the
// same pattern as button.component.test.tsx).
jest.mock('../../design-system/components/symbol', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <RNText>{`icon:${name}`}</RNText>,
  };
});

const mockUnlock = jest.fn();
const mockAppLock = { current: { isReady: true, isLocked: false, unlock: mockUnlock } };
jest.mock('../use-app-lock', () => ({
  useAppLock: () => mockAppLock.current,
}));

// MigrationsGate pulls in the op-sqlite native binding (via `./client`) and
// the legacy-token migration, neither of which has a jest binary; stub its
// init-chain dependencies so it resolves promptly to `success`, exercising
// the real `applyPersistedLanguage` step this test targets (same pattern as
// migrations.gate.test.tsx). `useAppLock` stays mocked above, so this
// `settingsRepo` stub is only reached by `MigrationsGate` itself.
type SettingsRow = { language?: string | null };
const mockGetSettings = jest.fn<Promise<SettingsRow[]>, []>();
jest.mock('../../db/client', () => ({ initDatabase: () => Promise.resolve() }));
jest.mock('../../db/run-migrations', () => ({ runMigrations: () => Promise.resolve() }));
jest.mock('../../monobank/token', () => ({ migrateLegacyToken: () => Promise.resolve() }));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { ensure: () => Promise.resolve(), getQuery: () => mockGetSettings() },
}));

const renderGate = () =>
  render(
    <LockGate>
      <Text>secret balances</Text>
    </LockGate>,
  );

describe('LockGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnlock.mockResolvedValue({ kind: 'success' });
    mockAppLock.current = { isReady: true, isLocked: false, unlock: mockUnlock };
    mockGetSettings.mockResolvedValue([]);
  });

  it('renders the children when unlocked and never prompts', async () => {
    const { getByText, queryByTestId } = await renderGate();

    expect(getByText('secret balances')).toBeTruthy();
    expect(queryByTestId('lock-gate')).toBeNull();
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it('renders neither the children nor the prompt while the lock state is unresolved', async () => {
    mockAppLock.current = { isReady: false, isLocked: false, unlock: mockUnlock };
    const { queryByText, queryByTestId } = await renderGate();

    expect(queryByText('secret balances')).toBeNull();
    expect(queryByTestId('lock-gate')).toBeNull();
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it('renders the unlock prompt instead of the children when locked, and prompts once on mount', async () => {
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    const { getByTestId, getByText, queryByText } = await renderGate();

    expect(getByTestId('lock-gate')).toBeTruthy();
    expect(getByText('Locked')).toBeTruthy();
    expect(getByText('Unlock')).toBeTruthy();
    expect(queryByText('secret balances')).toBeNull();
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });

  it('shows the Face ID glyph on the lock prompt', async () => {
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    const { getByText } = await renderGate();

    // The lock screen leads with the Face ID symbol, not a padlock.
    expect(getByText('icon:faceid')).toBeTruthy();
  });

  it('re-prompts when the Unlock button is pressed', async () => {
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    const { getByText } = await renderGate();

    await act(async () => {
      await fireEvent.press(getByText('Unlock'));
    });

    expect(mockUnlock).toHaveBeenCalledTimes(2);
  });

  it('offers the passcode after a biometry lockout', async () => {
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    mockUnlock.mockResolvedValue({ kind: 'lockout' });
    const { findByText } = await renderGate();

    expect(await findByText('Use passcode')).toBeTruthy();
    expect(await findByText('Face ID is locked. Use your device passcode instead.')).toBeTruthy();
  });

  it('explains a cancelled attempt and keeps the Unlock affordance', async () => {
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    mockUnlock.mockResolvedValue({ kind: 'cancelled' });
    const { findByText, getByText } = await renderGate();

    expect(await findByText('Authentication was cancelled.')).toBeTruthy();
    expect(getByText('Unlock')).toBeTruthy();
  });

  it('renders the lock screen in the persisted language, not the device language', async () => {
    // Device is `en` (the i18n module's init default under test); settings say
    // `uk`. Wraps `LockGate` in the real `MigrationsGate` deliberately — that
    // composition (App.tsx) is what the cold-launch fix relies on.
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    mockGetSettings.mockResolvedValue([{ language: 'uk' }]);

    const { getByText } = await render(
      <MigrationsGate>
        <LockGate>
          <Text>unlocked</Text>
        </LockGate>
      </MigrationsGate>,
    );

    await waitFor(() => {
      expect(getByText('Заблоковано')).toBeTruthy();
    });
  });
});
