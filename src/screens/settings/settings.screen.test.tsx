import { act, fireEvent, render, within } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { i18n } from '../../i18n';

import SettingsScreen from './settings.screen';

// The App Lock card moved to the System sub-screen, so the main Settings screen
// never renders it regardless of the flag. This suite pins APP_LOCK_ENABLED OFF
// and asserts the card is absent here; the visible/hidden App Lock paths now
// live in system.screen.test.tsx and system.screen.app-lock-off.test.tsx.
jest.mock('../../db/db-config', () => ({ APP_LOCK_ENABLED: false }));

const mockSetBaseCurrency = jest.fn();
let mockLiveQueryData: Array<{ baseCurrency: string }> = [{ baseCurrency: 'UAH' }];

jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setBaseCurrency: (...args: unknown[]) => mockSetBaseCurrency(...args),
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
  useScrollToTopOnTabPress: (ref: unknown) => mockUseScrollToTopOnTabPress(ref),
}));

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = [{ baseCurrency: 'UAH' }];
  });

  it('wires its scroll view to scroll to top on an active-tab re-tap', async () => {
    await render(<SettingsScreen />);

    expect(mockUseScrollToTopOnTabPress).toHaveBeenCalled();
    // The ref handed to the hook is the SAME one the Screen mounts on its
    // ScrollView — after render it resolves to that live scroll view, so an
    // active-tab re-tap has a real scrollable to return to the top.
    const scrollRef = mockUseScrollToTopOnTabPress.mock.calls.at(-1)?.[0];
    expect(typeof scrollRef?.current?.scrollTo).toBe('function');
  });

  it('does not render an in-screen "Settings" title (the native header provides it)', async () => {
    const { queryByText } = await render(<SettingsScreen />);
    expect(queryByText('Settings')).toBeNull();
  });

  it('shows the current base currency', async () => {
    const { getByText } = await render(<SettingsScreen />);
    expect(getByText(/UAH/)).toBeTruthy();
  });

  it('renders the base-currency entry as a single full-width settings row, not a bare boxed card', async () => {
    const { getByTestId } = await render(<SettingsScreen />);
    expect(getByTestId('settings-row-base-currency')).toBeTruthy();
  });

  it('renders each setting in its own separate card, not one shared grouped card', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByTestId } = await render(<SettingsScreen navigation={navigation} />);

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

  it('renders the System navigation card at the very top, above Base Currency and Categories', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByTestId, getAllByTestId } = await render(
      <SettingsScreen navigation={navigation} />,
    );

    expect(getByTestId('settings-card-system')).toBeTruthy();
    expect(getByTestId('settings-row-system')).toBeTruthy();

    // GlassSurface renders an inner `<id>-base` layer node under each card, so
    // filter those out to compare just the top-level card order.
    const cardOrder = getAllByTestId(/^settings-card-/)
      .map((node) => node.props.testID as string)
      .filter((testID) => !testID.endsWith('-base'));
    expect(cardOrder).toEqual([
      'settings-card-system',
      'settings-card-base-currency',
      'settings-card-categories',
    ]);
  });

  it('navigates to the System sub-screen when the System row is pressed', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByTestId } = await render(<SettingsScreen navigation={navigation} />);

    await fireEvent.press(getByTestId('settings-row-system'));

    expect(navigation.navigate).toHaveBeenCalledWith('System');
  });

  it('no longer renders the Language card (it moved to the System sub-screen)', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { queryByTestId } = await render(<SettingsScreen navigation={navigation} />);
    expect(queryByTestId('settings-card-language')).toBeNull();
    expect(queryByTestId('settings-row-language')).toBeNull();
  });

  it('renders each currency option as its own independently pressable control within the row (no shared multi-action box)', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getAllByRole } = await render(<SettingsScreen navigation={navigation} />);
    // BTC, USD, EUR, UAH — four separate currency pressables — plus the two
    // navigating rows' own pressables (System, Categories) — 6 total. Language
    // moved to the System sub-screen, so its two pressables are gone from here.
    expect(getAllByRole('button')).toHaveLength(6);
  });

  it('navigates to the Categories sub-screen when the Categories row is pressed', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByTestId } = await render(<SettingsScreen navigation={navigation} />);

    await fireEvent.press(getByTestId('settings-row-categories'));

    expect(navigation.navigate).toHaveBeenCalledWith('Categories');
  });

  it('calls setBaseCurrency when a currency option is pressed', async () => {
    const { getByText } = await render(<SettingsScreen />);
    await fireEvent.press(getByText('USD'));
    expect(mockSetBaseCurrency).toHaveBeenCalledWith('USD');
  });

  it('no longer renders the App Lock card (it moved to the System sub-screen)', async () => {
    const { queryByTestId } = await render(<SettingsScreen />);
    expect(queryByTestId('settings-card-app-lock')).toBeNull();
  });

  it('no longer renders the Monobank token input (it lives on the bank account now)', async () => {
    const { queryByPlaceholderText, queryByText } = await render(<SettingsScreen />);
    expect(queryByPlaceholderText('Monobank token')).toBeNull();
    expect(queryByText('Save')).toBeNull();
    expect(queryByText('Paste from clipboard')).toBeNull();
    expect(queryByText('Open api.monobank.ua')).toBeNull();
  });

  it('no longer renders the sync-status card (it lives on the bank account now)', async () => {
    const { queryByText } = await render(<SettingsScreen />);
    expect(queryByText(/Last sync/i)).toBeNull();
    expect(queryByText(/Sync status/i)).toBeNull();
  });

  it('does not render a Sync button (sync is per-account now)', async () => {
    const { queryByText } = await render(<SettingsScreen />);
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
    const { getByText } = await render(<SettingsScreen />);

    expect(getByText('Base Currency')).toBeTruthy();
    expect(getByText('System')).toBeTruthy();
  });

  it('renders Ukrainian catalog strings under uk', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
    const { getByText } = await render(<SettingsScreen />);

    expect(getByText('Основна валюта')).toBeTruthy();
    expect(getByText('Система')).toBeTruthy();
  });
});
