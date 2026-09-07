import { act, fireEvent, render, within } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import '../../design-system/unistyles';
import { i18n } from '../../i18n';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
} from '../../test-support/navigation-props';

import SettingsScreen from './settings.screen';

type SettingsProps = ComponentProps<typeof SettingsScreen>;

// The screen takes both React Navigation props; only `navigation` is read, so a
// test that asserts on a navigate passes its own spy and the rest default.
const renderScreen = (navigation: NavigationSpy = navigationSpy()) =>
  render(
    <SettingsScreen
      navigation={asNavigationProp<SettingsProps['navigation']>(navigation)}
      route={asRouteProp<SettingsProps['route']>('Settings')}
    />,
  );

// APP_LOCK_ENABLED is now ON by default. This suite covers the disabled/hidden
// App Lock path, so it pins the flag OFF locally — the mirror of
// settings.screen.app-lock.test.tsx, which pins it ON to cover the visible-card
// path. Both paths stay covered without relying on the shipped default.
jest.mock('../../db/db-config', () => ({ APP_LOCK_ENABLED: false }));

const mockSetBaseCurrency = jest.fn();
const mockSetLanguage = jest.fn();
let mockLiveQueryData: Array<{ baseCurrency: string; language?: 'en' | 'uk' | null }> = [
  { baseCurrency: 'UAH' },
];

jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setBaseCurrency: (...args: unknown[]) => mockSetBaseCurrency(...args),
    setLanguage: (...args: unknown[]) => mockSetLanguage(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData }),
}));

// The active-tab re-tap → scroll-to-top hook reads the navigation context, which
// a standalone screen render lacks; stand it in with a spy so this test can
// assert the screen hands it the scroll view's own ref.
const mockUseScrollToTopOnTabPress = jest.fn();
jest.mock('../../navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: (ref: unknown, scrollOffset: unknown) =>
    mockUseScrollToTopOnTabPress(ref, scrollOffset),
}));

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = [{ baseCurrency: 'UAH' }];
  });

  it('wires its scroll view to scroll to top on an active-tab re-tap', async () => {
    await renderScreen();

    expect(mockUseScrollToTopOnTabPress).toHaveBeenCalled();
    // The ref handed to the hook is the SAME one the Screen mounts on its
    // ScrollView — after render it resolves to that live scroll view, so an
    // active-tab re-tap has a real scrollable to return to the top.
    const scrollRef = mockUseScrollToTopOnTabPress.mock.calls.at(-1)?.[0];
    expect(typeof scrollRef?.current?.scrollTo).toBe('function');
  });

  it('hands the hook the live scroll offset of that same scroll view', async () => {
    // The hook skips its scroll when the content is already at the top, which it
    // can only decide from the live `contentOffset.y` of the scroll view it
    // would scroll — so the offset must be derived from the SAME ref the hook
    // receives, not from some other scrollable.
    const reanimated = require('react-native-reanimated') as {
      useScrollOffset: (ref: unknown) => unknown;
    };
    const offsetSpy = jest.spyOn(reanimated, 'useScrollOffset');

    await renderScreen();

    const lastCall = mockUseScrollToTopOnTabPress.mock.calls.at(-1);
    expect(offsetSpy).toHaveBeenCalledWith(lastCall?.[0]);
    expect(lastCall?.[1]).toBe(offsetSpy.mock.results.at(-1)?.value);

    offsetSpy.mockRestore();
  });

  it('does not render an in-screen "Settings" title (the native header provides it)', async () => {
    const { queryByText } = await renderScreen();
    expect(queryByText('Settings')).toBeNull();
  });

  it('shows the current base currency', async () => {
    const { getByText } = await renderScreen();
    expect(getByText(/UAH/)).toBeTruthy();
  });

  it('renders the base-currency entry as a single full-width settings row, not a bare boxed card', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('settings-row-base-currency')).toBeTruthy();
  });

  it('renders each setting in its own separate card, not one shared grouped card', async () => {
    const navigation = navigationSpy();
    const { getByTestId } = await renderScreen(navigation);

    const currencyCard = getByTestId('settings-card-base-currency');
    const categoriesCard = getByTestId('settings-card-categories');

    // Two distinct GlassSurface cards, one per setting.
    expect(currencyCard).toBeTruthy();
    expect(categoriesCard).toBeTruthy();
    expect(currencyCard).not.toBe(categoriesCard);

    // The base-currency row lives only inside its own card...
    expect(within(currencyCard).getByTestId('settings-row-base-currency')).toBeTruthy();
    expect(within(currencyCard).queryByTestId('settings-row-categories')).toBeNull();

    // ...and the Categories row lives only inside its own card.
    expect(within(categoriesCard).getByTestId('settings-row-categories')).toBeTruthy();
    expect(within(categoriesCard).queryByTestId('settings-row-base-currency')).toBeNull();
  });

  it('renders each currency option as its own independently pressable control within the row (no shared multi-action box)', async () => {
    const navigation = navigationSpy();
    const { getAllByRole } = await renderScreen(navigation);
    // BTC, USD, EUR, UAH — four separate currency pressables, English/Ukrainian
    // — two separate language pressables — not one combined control — plus the
    // navigating Categories row's own pressable (7 total).
    expect(getAllByRole('button')).toHaveLength(7);
  });

  it('navigates to the Categories sub-screen when the Categories row is pressed', async () => {
    const navigation = navigationSpy();
    const { getByTestId } = await renderScreen(navigation);

    await fireEvent.press(getByTestId('settings-row-categories'));

    expect(navigation.navigate).toHaveBeenCalledWith('Categories');
  });

  it('calls setBaseCurrency when a currency option is pressed', async () => {
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('USD'));
    expect(mockSetBaseCurrency).toHaveBeenCalledWith('USD');
  });

  it('renders the language card and persists a language choice', async () => {
    const { getByTestId, getByText } = await renderScreen();

    expect(getByTestId('settings-card-language')).toBeTruthy();

    await fireEvent.press(getByText('🇺🇦 Українська'));

    expect(mockSetLanguage).toHaveBeenCalledWith('uk');
  });

  it('shows the stored language as selected, proving effectiveLanguage wiring end-to-end', async () => {
    mockLiveQueryData = [{ baseCurrency: 'UAH', language: 'uk' }];
    const { getByText } = await renderScreen();

    expect(getByText('🇺🇦 Українська').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('🇬🇧 English').parent?.props.accessibilityState.selected).toBe(false);
  });

  it('hides the App Lock card while APP_LOCK_ENABLED is off (pinned off in this suite)', async () => {
    const { queryByTestId } = await renderScreen();
    expect(queryByTestId('settings-card-app-lock')).toBeNull();
  });

  it('no longer renders the Monobank token input (it lives on the bank account now)', async () => {
    const { queryByPlaceholderText, queryByText } = await renderScreen();
    expect(queryByPlaceholderText('Monobank token')).toBeNull();
    expect(queryByText('Save')).toBeNull();
    expect(queryByText('Paste from clipboard')).toBeNull();
    expect(queryByText('Open api.monobank.ua')).toBeNull();
  });

  it('no longer renders the sync-status card (it lives on the bank account now)', async () => {
    const { queryByText } = await renderScreen();
    expect(queryByText(/Last sync/i)).toBeNull();
    expect(queryByText(/Sync status/i)).toBeNull();
  });

  it('does not render a Sync button (sync is per-account now)', async () => {
    const { queryByText } = await renderScreen();
    expect(queryByText('Sync')).toBeNull();
  });
});

describe('SettingsScreen — localization', () => {
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

    expect(getByText('Base Currency')).toBeTruthy();
    expect(getByText('Language')).toBeTruthy();
  });

  it('renders Ukrainian catalog strings under uk', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
    const { getByText } = await renderScreen();

    expect(getByText('Основна валюта')).toBeTruthy();
    expect(getByText('Мова')).toBeTruthy();
  });
});
