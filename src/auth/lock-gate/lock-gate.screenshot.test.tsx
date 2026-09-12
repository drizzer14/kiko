import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import '../../design-system/unistyles';
import '../../i18n';

import LockGate from './lock-gate.component';

// The SF Symbol glyph is a native SFSymbolView; render it as a plain text node
// so the lock screen is queryable without the native module (same pattern as
// lock-gate.component.test.tsx).
jest.mock('../../design-system/components/symbol', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <RNText>{`icon:${name}`}</RNText>,
  };
});

// Force screenshot mode ON so the mount-time biometric auto-invoke guard is
// exercised. In a real build this is inlined `false` (production is unchanged);
// mocking the module is the only way to flip it under Jest, where `@env` is
// build-time inlined and cannot be re-read at runtime.
jest.mock('../../screenshot/screenshot-mode', () => ({
  isScreenshotMode: () => true,
}));

const mockUnlock = jest.fn();
const mockAppLock = { current: { isReady: true, isLocked: true, unlock: mockUnlock } };
jest.mock('../use-app-lock', () => ({
  useAppLock: () => mockAppLock.current,
}));

const renderGate = () =>
  render(
    <LockGate>
      <Text>secret balances</Text>
    </LockGate>,
  );

describe('LockGate in screenshot mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnlock.mockResolvedValue({ kind: 'success' });
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
  });

  it('renders the locked screen but does NOT auto-invoke biometrics on mount', async () => {
    const { getByTestId, getByText, queryByText } = await renderGate();

    // The lock screen is captured for the screenshot: gate + Face ID glyph +
    // the manual Unlock affordance, with the children hidden.
    expect(getByTestId('lock-gate')).toBeTruthy();
    expect(getByText('icon:faceid')).toBeTruthy();
    expect(getByText('Unlock')).toBeTruthy();
    expect(queryByText('secret balances')).toBeNull();

    // Crucially: no biometric sheet was auto-invoked on mount, so the sim never
    // hits the system dialog (which would block Maestro) or a Keychain SIGABRT.
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it('still unlocks manually when the Unlock button is pressed', async () => {
    const { getByText } = await renderGate();

    await act(async () => {
      await fireEvent.press(getByText('Unlock'));
    });

    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });
});
