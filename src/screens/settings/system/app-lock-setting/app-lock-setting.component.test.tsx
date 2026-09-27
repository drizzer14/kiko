import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';

import AppLockSetting from './app-lock-setting.component';

const mockIsSensorAvailable = jest.fn();
jest.mock('@kiko/auth/biometrics', () => ({
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
    expect(getByText('App lock')).toBeTruthy();
    expect(getByText('Require Face ID or passcode')).toBeTruthy();
    expect(await findByRole('switch')).toBeEnabled();
    expect(queryByText(/Set a device passcode/)).toBeNull();
    expect(queryByText(/unavailable/)).toBeNull();
    expect(queryByText(/No Face ID enrolled/)).toBeNull();
  });

  // The App Lock card is the shared solid content-layer `Card`: a flat
  // `surface` fill applied directly to its own node (see `Card`'s own doc
  // comment for why content no longer routes through `GlassSurface`/Liquid
  // Glass at all).
  it('fills the App Lock card with the shared solid surface token', async () => {
    const { getByTestId } = await renderSetting();

    const flat = StyleSheet.flatten(getByTestId('settings-card-app-lock').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
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
    expect(await findByText('Set a device passcode in iOS Settings to use app lock.')).toBeTruthy();
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
