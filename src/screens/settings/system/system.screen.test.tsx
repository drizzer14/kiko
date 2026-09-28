import type { ComponentProps } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import SystemScreen from './system.screen';

const mockConfirmOwner = jest.fn();
jest.mock('@kiko/auth/confirm-owner', () => ({
  confirmOwner: (...args: unknown[]) => mockConfirmOwner(...args),
}));

type SystemProps = ComponentProps<typeof SystemScreen>;

// SystemScreen is a pushed screen; it reads neither navigation nor route, but
// both props are required by its type, so present the standard test spies.
const renderScreen = () =>
  render(
    <SystemScreen
      navigation={asNavigationProp<SystemProps['navigation']>(navigationSpy())}
      route={asRouteProp<SystemProps['route']>('System')}
    />,
  );

const mockSetLanguage = jest.fn();
const mockSetLockEnabled = jest.fn();
let mockLiveQueryData: Array<{
  baseCurrency: string;
  language?: 'en' | 'uk' | null;
  lockEnabled?: boolean;
}> = [{ baseCurrency: 'UAH', lockEnabled: false }];
let mockLiveQueryIsLoading = false;

jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setLanguage: (...args: unknown[]) => mockSetLanguage(...args),
    setLockEnabled: (...args: unknown[]) => mockSetLockEnabled(...args),
  },
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData, isLoading: mockLiveQueryIsLoading }),
}));

describe('SystemScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = [{ baseCurrency: 'UAH', lockEnabled: false }];
    mockLiveQueryIsLoading = false;
  });

  it('renders the Language card', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('settings-card-language')).toBeTruthy();
  });

  // The Language card is the shared solid content-layer `Card`: a flat
  // `surface` fill applied directly to its own node (see `Card`'s own doc
  // comment for why content no longer routes through `GlassSurface`/Liquid
  // Glass at all).
  it('fills the Language card with the shared solid surface token', async () => {
    const { getByTestId } = await renderScreen();

    const flat = StyleSheet.flatten(getByTestId('settings-card-language').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
  });

  it('renders the Face ID (App Lock) card', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('settings-card-app-lock')).toBeTruthy();
  });

  it('renders Language, then Face ID in that order', async () => {
    const { getAllByTestId } = await renderScreen();

    const cardOrder = getAllByTestId(/^settings-card-/).map((node) => node.props.testID);

    const languageIndex = cardOrder.indexOf('settings-card-language');
    const appLockIndex = cardOrder.indexOf('settings-card-app-lock');

    expect(languageIndex).toBeLessThan(appLockIndex);
  });

  it('persists a language choice', async () => {
    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('🇺🇦 Українська'));

    expect(mockSetLanguage).toHaveBeenCalledWith('uk');
  });

  it('shows the stored language as selected, proving effectiveLanguage wiring end-to-end', async () => {
    mockLiveQueryData = [{ baseCurrency: 'UAH', language: 'uk', lockEnabled: false }];
    const { getByText } = await renderScreen();

    expect(getByText('🇺🇦 Українська').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('🇬🇧 English').parent?.props.accessibilityState.selected).toBe(false);
  });

  it('turns the lock on directly, with no re-authentication', async () => {
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', true);

    expect(mockSetLockEnabled).toHaveBeenCalledWith(true);
    expect(mockConfirmOwner).not.toHaveBeenCalled();
  });
});

describe('SystemScreen — turning the lock off re-authenticates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = [{ baseCurrency: 'UAH', lockEnabled: true }];
    mockLiveQueryIsLoading = false;
  });

  it('confirms the owner with the disable-lock reason, then turns the lock off', async () => {
    mockConfirmOwner.mockResolvedValue({ kind: 'confirmed' });
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', false);

    await waitFor(() => expect(mockSetLockEnabled).toHaveBeenCalledWith(false));
    expect(mockConfirmOwner).toHaveBeenCalledWith('Turn off app lock');
  });

  // A device with no passcode has no owner authentication to run at all —
  // blocking the lock-off here would leave no way to ever turn it off again.
  it('turns the lock off with no alert when the device has no passcode', async () => {
    mockConfirmOwner.mockResolvedValue({ kind: 'noPasscode' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', false);

    await waitFor(() => expect(mockSetLockEnabled).toHaveBeenCalledWith(false));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('leaves the lock on when the owner cancels, with no alert', async () => {
    mockConfirmOwner.mockResolvedValue({ kind: 'cancelled' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', false);

    await waitFor(() => expect(mockConfirmOwner).toHaveBeenCalled());
    expect(mockSetLockEnabled).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('leaves the lock on and alerts when owner confirmation fails', async () => {
    mockConfirmOwner.mockResolvedValue({ kind: 'failed', hintKey: 'auth.hint.failed' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', false);

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Couldn't confirm it's you",
        'Authentication failed. Try again.',
      ),
    );
    expect(mockSetLockEnabled).not.toHaveBeenCalled();
  });

  it('confirms the owner only once for two OFF toggles before the first settles', async () => {
    let resolveConfirm: (confirmation: { kind: string }) => void = () => {};
    mockConfirmOwner.mockReturnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', false);
    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', false);

    expect(mockConfirmOwner).toHaveBeenCalledTimes(1);

    resolveConfirm({ kind: 'confirmed' });
    await waitFor(() => expect(mockSetLockEnabled).toHaveBeenCalledWith(false));
  });

  it('re-arms the toggle after confirmAndDisable rejects, so a retry can run', async () => {
    mockConfirmOwner.mockRejectedValueOnce(new Error('boom'));
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', false);

    await waitFor(() => expect(mockConfirmOwner).toHaveBeenCalledTimes(1));

    mockConfirmOwner.mockResolvedValueOnce({ kind: 'confirmed' });
    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', false);

    await waitFor(() => expect(mockConfirmOwner).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockSetLockEnabled).toHaveBeenCalledWith(false));
  });
});

describe('SystemScreen — loading gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = [];
    mockLiveQueryIsLoading = true;
  });

  it('shows a loading spinner, not App Lock off or the device-default language, while settings is on its first load', async () => {
    const { getByTestId, queryByTestId, queryByText } = await renderScreen();

    expect(getByTestId('system-loading')).toBeTruthy();
    expect(queryByTestId('settings-card-language')).toBeNull();
    expect(queryByTestId('settings-card-app-lock')).toBeNull();
    expect(queryByText('🇺🇦 Українська')).toBeNull();
  });

  it('renders the real content once settings has loaded', async () => {
    mockLiveQueryIsLoading = false;
    mockLiveQueryData = [{ baseCurrency: 'UAH', lockEnabled: false }];

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('settings-card-language')).toBeTruthy();
    expect(queryByTestId('system-loading')).toBeNull();
  });
});

describe('SystemScreen — localization', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders English catalog strings under en', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    const { getByText } = await renderScreen();

    expect(getByText('Language')).toBeTruthy();
  });

  it('renders Ukrainian catalog strings under uk', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
    const { getByText } = await renderScreen();

    expect(getByText('Мова')).toBeTruthy();
  });
});
