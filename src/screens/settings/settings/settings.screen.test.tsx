import type { ComponentProps } from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';
import pkg from '../../../../package.json';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
} from '../../../test-support/navigation-props';

import SettingsScreen from './settings.screen';

type SettingsProps = ComponentProps<typeof SettingsScreen>;

const mockOpenURL = jest.fn();

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));

// The screen takes both React Navigation props; only `navigation` is read, so a
// test that asserts on a navigate passes its own spy and the rest default.
const renderScreen = (navigation: NavigationSpy = navigationSpy()) =>
  render(
    <SettingsScreen
      navigation={asNavigationProp<SettingsProps['navigation']>(navigation)}
      route={asRouteProp<SettingsProps['route']>('Settings')}
    />,
  );

// The App Lock card moved to the System sub-screen, so the main Settings screen
// never renders it regardless of the flag. This suite pins APP_LOCK_ENABLED OFF
// and asserts the card is absent here; the visible/hidden App Lock paths now
// live in system.screen.test.tsx and system.screen.app-lock-off.test.tsx.
jest.mock('../../../db/db-config', () => ({ APP_LOCK_ENABLED: false }));

const mockSetBaseCurrency = jest.fn();
let mockLiveQueryData: Array<{ baseCurrency: string }> = [{ baseCurrency: 'UAH' }];

jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setBaseCurrency: (...args: unknown[]) => mockSetBaseCurrency(...args),
  },
}));
jest.mock('../../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData }),
}));

// The active-tab re-tap → scroll-to-top hook reads the navigation context, which
// a standalone screen render lacks; stand it in with a spy so this test can
// assert the screen hands it the scroll view's own ref.
const mockUseScrollToTopOnTabPress = jest.fn();
jest.mock('../../../navigation/use-scroll-to-top-on-tab-press', () => ({
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

  // DEVICE BUG (review, 2026-09-14): CurrencyField's own trigger no longer
  // shows the ISO code at all (see `currency-field.component.tsx`'s
  // `triggerValue`) — it shows the localized NAME only, matching the option
  // rows. This used to match the bare "UAH" substring inside the old
  // "UAH — Ukrainian Hryvnia" trigger value; assert the localized name
  // instead, the same fix already made to CurrencyField's own tests.
  it('shows the current base currency', async () => {
    const { getByText } = await renderScreen();
    expect(getByText('Ukrainian Hryvnia')).toBeTruthy();
  });

  it('renders the base-currency entry as a single full-width settings row, not a bare boxed card', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('settings-row-base-currency')).toBeTruthy();
  });

  it('frames the base-currency row like every other settings row, with a leading hryvniasign.circle icon', async () => {
    const { root } = await renderScreen();

    // The row is wrapped in a SettingsRow, so it carries the same leading-icon
    // chrome as the System/Categories rows — the icon glyph is the mocked
    // SFSymbolView, which forwards `name` as a host prop. The hryvniasign.circle
    // glyph is unique to the base-currency row, so a whole-tree lookup suffices.
    const glyphs = root?.queryAll((node) => node.props.name === 'hryvniasign.circle') ?? [];
    expect(glyphs.length).toBeGreaterThan(0);
  });

  it('gives the Categories row a leading tag icon', async () => {
    const { root } = await renderScreen();

    // The Categories row carries the Kiko UI `tag` glyph — the same standard the
    // category-field placeholder and new-category default use.
    const glyphs = root?.queryAll((node) => node.props.name === 'tag') ?? [];
    expect(glyphs.length).toBeGreaterThan(0);
  });

  it('labels the base-currency control exactly once (SettingsRow labels it, CurrencyField shows no duplicate caption)', async () => {
    const { getAllByText } = await renderScreen();

    // The SettingsRow renders "Base Currency"; the CurrencyField must NOT also
    // render its own inline caption, or the label would appear twice.
    expect(getAllByText('Base Currency')).toHaveLength(1);
  });

  it('renders each setting in its own separate card, not one shared grouped card', async () => {
    const navigation = navigationSpy();
    const { getByTestId } = await renderScreen(navigation);

    const currencyCard = getByTestId('settings-card-base-currency');
    const categoriesCard = getByTestId('settings-card-categories');

    // Two distinct Card surfaces, one per setting.
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
    const { getByTestId, getAllByTestId } = await renderScreen();

    expect(getByTestId('settings-card-system')).toBeTruthy();
    expect(getByTestId('settings-row-system')).toBeTruthy();

    // `Card` renders a single flat node per testID (no inner `-base` layer the
    // way `GlassSurface` used to), but the filter is kept defensively so this
    // assertion only ever compares top-level card order.
    const cardOrder = getAllByTestId(/^settings-card-/)
      .map((node) => node.props.testID as string)
      .filter((testID) => !testID.endsWith('-base'));
    expect(cardOrder).toEqual([
      'settings-card-system',
      'settings-card-base-currency',
      'settings-card-categories',
      'settings-card-data-transfer',
    ]);
  });

  it('groups Import and Export into one shared card, Import first', async () => {
    const { getByTestId, getAllByTestId } = await renderScreen();

    const card = getByTestId('settings-card-data-transfer');

    // Both rows live inside the one shared card...
    expect(within(card).getByTestId('settings-row-import-data')).toBeTruthy();
    expect(within(card).getByTestId('settings-row-export-data')).toBeTruthy();

    // ...with Import rendered before Export, in document order.
    const rowOrder = getAllByTestId(/^settings-row-(import|export)-data$/).map(
      (node) => node.props.testID as string,
    );
    expect(rowOrder).toEqual(['settings-row-import-data', 'settings-row-export-data']);
  });

  it('separates Import and Export with a divider, between the two rows', async () => {
    const { getByTestId, getAllByTestId } = await renderScreen();

    const card = getByTestId('settings-card-data-transfer');

    expect(within(card).getByTestId('settings-divider-data-transfer')).toBeTruthy();

    // The divider sits BETWEEN the two rows, matching the iOS grouped-list style.
    const order = getAllByTestId(/^settings-(row-(import|export)-data|divider-data-transfer)$/).map(
      (node) => node.props.testID as string,
    );
    expect(order).toEqual([
      'settings-row-import-data',
      'settings-divider-data-transfer',
      'settings-row-export-data',
    ]);
  });

  it('navigates to the System sub-screen when the System row is pressed', async () => {
    const navigation = navigationSpy();
    const { getByTestId } = await renderScreen(navigation);

    await fireEvent.press(getByTestId('settings-row-system'));

    expect(navigation.navigate).toHaveBeenCalledWith('System');
  });

  it('no longer renders the Language card (it moved to the System sub-screen)', async () => {
    const { queryByTestId } = await renderScreen();
    expect(queryByTestId('settings-card-language')).toBeNull();
    expect(queryByTestId('settings-row-language')).toBeNull();
  });

  it('offers a fiat-only base-currency picker (no crypto selectable as base)', async () => {
    const { getByPlaceholderText, getByTestId, queryByTestId } = await renderScreen();

    // The base currency now uses the shared searchable CurrencyField: tapping its
    // trigger opens the picker sheet, whose options are restricted to fiat — BTC
    // (crypto) is never offered as a base currency, but the fiat codes are.
    await fireEvent.press(getByTestId('settings-row-base-currency'));
    // Narrow by search: unfiltered, USD sorts alphabetically by its localized
    // name ("US Dollar") well outside the FlatList's virtualized initial window
    // (`initialNumToRender={15}`).
    await fireEvent.changeText(getByPlaceholderText('Search by code or name'), 'USD');

    expect(getByTestId('currency-option-USD')).toBeTruthy();
    expect(queryByTestId('currency-option-BTC')).toBeNull();
  });

  it('navigates to the Categories sub-screen when the Categories row is pressed', async () => {
    const navigation = navigationSpy();
    const { getByTestId } = await renderScreen(navigation);

    await fireEvent.press(getByTestId('settings-row-categories'));

    expect(navigation.navigate).toHaveBeenCalledWith('Categories');
  });

  it('navigates to the ExportData sub-screen when the Export Data row is pressed', async () => {
    const navigation = navigationSpy();
    const { findByTestId } = await renderScreen(navigation);

    fireEvent.press(await findByTestId('settings-row-export-data'));

    expect(navigation.navigate).toHaveBeenCalledWith('ExportData');
  });

  it('navigates to the ImportData sub-screen when the Import Data row is pressed', async () => {
    const navigation = navigationSpy();
    const { findByTestId } = await renderScreen(navigation);

    fireEvent.press(await findByTestId('settings-row-import-data'));

    expect(navigation.navigate).toHaveBeenCalledWith('ImportData');
  });

  it('calls setBaseCurrency when a currency option is pressed', async () => {
    const { getByPlaceholderText, getByTestId } = await renderScreen();

    // Open the CurrencyField sheet, then pick a currency row.
    await fireEvent.press(getByTestId('settings-row-base-currency'));
    // Narrow by search: unfiltered, USD sorts alphabetically by its localized
    // name ("US Dollar") well outside the FlatList's virtualized initial window
    // (`initialNumToRender={15}`).
    await fireEvent.changeText(getByPlaceholderText('Search by code or name'), 'USD');
    await fireEvent.press(getByTestId('currency-option-USD'));

    expect(mockSetBaseCurrency).toHaveBeenCalledWith('USD');
  });

  it('no longer renders the App Lock card (it moved to the System sub-screen)', async () => {
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

// The App Store compliance footer: app name + version (read from
// package.json, never hardcoded), copyright, and a Privacy Policy link that
// opens the page matching the current app language.
describe('SettingsScreen — footer', () => {
  beforeEach(() => {
    mockOpenURL.mockClear();
  });

  it('renders the app name and the version read from package.json', async () => {
    const { getByText } = await renderScreen();

    expect(getByText(`Kiko v${pkg.version}`)).toBeTruthy();
  });

  it('renders the copyright line with the current year', async () => {
    const { getByText } = await renderScreen();

    expect(getByText(`© ${new Date().getFullYear()} Dmytro Vasylkivskyi`)).toBeTruthy();
  });

  it('renders a Privacy Policy link that opens the English page under en', async () => {
    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Privacy Policy'));

    expect(mockOpenURL).toHaveBeenCalledWith('https://drizzer14.github.io/kiko/en.html');
  });

  // DEVICE BUG: the footer previously rendered as scroll CONTENT (a `flex: 1`
  // spacer plus `Screen`'s `fillHeight`), which pushed it below the fold on a
  // real device — the user had to scroll to see it. It must instead render
  // through `Screen`'s pinned `footer` slot, the same mechanism
  // `account-detail.screen.tsx` uses for its Add-holding button, so it always
  // stays visible just above the tab bar with no scrolling.
  it('pins the footer to the screen footer slot, not the scrolling content', async () => {
    const { getByTestId } = await renderScreen();

    const footer = getByTestId('screen-footer');
    const scrollView = getByTestId('screen-scroll-view');

    expect(within(footer).getByText(`Kiko v${pkg.version}`)).toBeTruthy();
    expect(within(scrollView).queryByText(`Kiko v${pkg.version}`)).toBeNull();
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
    expect(getByText('System')).toBeTruthy();
  });

  it('renders Ukrainian catalog strings under uk', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
    const { getByText } = await renderScreen();

    expect(getByText('Основна валюта')).toBeTruthy();
    expect(getByText('Системні')).toBeTruthy();
  });

  it('renders the Ukrainian footer strings and opens the Ukrainian Privacy Policy page under uk', async () => {
    mockOpenURL.mockClear();
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
    const { getByText } = await renderScreen();

    expect(getByText(`Кіко v${pkg.version}`)).toBeTruthy();
    expect(getByText(`© ${new Date().getFullYear()} Дмитро Васильківський`)).toBeTruthy();

    await fireEvent.press(getByText('Політика конфіденційності'));

    expect(mockOpenURL).toHaveBeenCalledWith('https://drizzer14.github.io/kiko');
  });
});
