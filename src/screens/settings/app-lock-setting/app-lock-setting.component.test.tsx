import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '../../../design-system/unistyles';
import '../../../i18n';
import { darkTheme } from '../../../design-system/theme';

import AppLockSetting from './app-lock-setting.component';

const mockIsSensorAvailable = jest.fn();
jest.mock('../../../auth/biometrics', () => ({
  isSensorAvailable: () => mockIsSensorAvailable(),
}));

const renderSetting = (overrides: Partial<Parameters<typeof AppLockSetting>[0]> = {}) =>
  render(<AppLockSetting lockEnabled={false} onToggle={jest.fn()} {...overrides} />);

describe('AppLockSetting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSensorAvailable.mockResolvedValue({ kind: 'available', biometryType: 'FaceID' });
  });

  it('renders the App Lock row in its own card with an enabled switch on a Face ID device', async () => {
    const { getByTestId, getByText, findByRole, queryByText } = await renderSetting();

    expect(getByTestId('settings-card-app-lock')).toBeTruthy();
    expect(getByTestId('settings-row-app-lock')).toBeTruthy();
    expect(getByText('App Lock')).toBeTruthy();
    expect(getByText('Require Face ID or Passcode')).toBeTruthy();
    expect(await findByRole('switch')).toBeEnabled();
    expect(queryByText(/Set a device passcode/)).toBeNull();
    expect(queryByText(/unavailable/)).toBeNull();
    expect(queryByText(/No Face ID enrolled/)).toBeNull();
  });

  // The app-wide bloom rollout: this card carries no `transparent`/`material`
  // variant, so before bloom its non-glass fallback rendered the plain,
  // OPAQUE themed `surface` fill. Adding `bloom` (see GlassSurface's
  // `resolveFallbackFill`) makes the fallback fill TRANSLUCENT instead —
  // the one observable-under-Jest regression bloom's fallback path
  // introduces for a previously-plain surface.
  it('fills the App Lock card fallback base with the translucent bloom token, not the plain opaque surface', async () => {
    const { getByTestId } = await renderSetting();

    const flat = StyleSheet.flatten(getByTestId('settings-card-app-lock-base').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(flat.backgroundColor).not.toBe(darkTheme.colors.surface);
  });

  it('reports a toggle', async () => {
    const onToggle = jest.fn();
    const { findByRole } = await renderSetting({ onToggle });

    await fireEvent(await findByRole('switch'), 'valueChange', true);

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('disables the switch with a hint when the device has no passcode', async () => {
    mockIsSensorAvailable.mockResolvedValue({ kind: 'passcodeNotSet' });
    const { findByRole, findByText } = await renderSetting();

    expect(await findByRole('switch')).toBeDisabled();
    expect(await findByText('Set a device passcode in iOS Settings to use App Lock.')).toBeTruthy();
  });

  it('disables the switch with a hint when biometric hardware is unavailable', async () => {
    mockIsSensorAvailable.mockResolvedValue({ kind: 'unavailable' });
    const { findByRole, findByText } = await renderSetting();

    expect(await findByRole('switch')).toBeDisabled();
    expect(await findByText('Biometric hardware is unavailable on this device.')).toBeTruthy();
  });

  it('keeps the switch enabled with a passcode-only hint when no biometry is enrolled', async () => {
    mockIsSensorAvailable.mockResolvedValue({ kind: 'passcodeOnly' });
    const { findByRole, findByText } = await renderSetting();

    expect(await findByRole('switch')).toBeEnabled();
    expect(
      await findByText('No Face ID enrolled — your device passcode will be used.'),
    ).toBeTruthy();
  });
});
