import { act, fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
import { i18n } from '../../i18n';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import SystemScreen from './system.screen';

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

// APP_LOCK_ENABLED pinned ON so the Face ID (App Lock) card mounts — matching
// the app-lock test setup relocated from the main Settings screen. The
// flag-off / card-hidden path is covered in system.screen.app-lock.test.tsx.
jest.mock('../../db/db-config', () => ({ APP_LOCK_ENABLED: true }));

const mockSetLanguage = jest.fn();
const mockSetLockEnabled = jest.fn();
let mockLiveQueryData: Array<{
  baseCurrency: string;
  language?: 'en' | 'uk' | null;
  lockEnabled?: boolean;
}> = [{ baseCurrency: 'UAH', lockEnabled: false }];

jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setLanguage: (...args: unknown[]) => mockSetLanguage(...args),
    setLockEnabled: (...args: unknown[]) => mockSetLockEnabled(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData }),
}));

describe('SystemScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = [{ baseCurrency: 'UAH', lockEnabled: false }];
  });

  it('renders the Language card', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('settings-card-language')).toBeTruthy();
  });

  // The app-wide bloom rollout: this card carries no `transparent`/`material`
  // variant, so before bloom its non-glass fallback rendered the plain,
  // OPAQUE themed `surface` fill. Adding `bloom` (see GlassSurface's
  // `resolveFallbackFill`) makes the fallback fill TRANSLUCENT instead —
  // this is the one observable-under-Jest regression bloom's fallback path
  // introduces for a previously-plain surface.
  it('fills the Language card fallback base with the translucent bloom token, not the plain opaque surface', async () => {
    const { getByTestId } = await renderScreen();

    const flat = StyleSheet.flatten(getByTestId('settings-card-language-base').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(flat.backgroundColor).not.toBe(darkTheme.colors.surface);
  });

  it('renders the Face ID (App Lock) card while APP_LOCK_ENABLED is on', async () => {
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

  it('calls setLockEnabled when the App Lock switch is toggled', async () => {
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-app-lock'), 'valueChange', true);

    expect(mockSetLockEnabled).toHaveBeenCalledWith(true);
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
