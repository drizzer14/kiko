import { act, fireEvent, type RenderResult, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '../../../design-system/unistyles';
import { darkTheme } from '../../../design-system/theme';
import { i18n } from '../../../i18n';

import FilterMenu, { FILTER_ALL } from './filter-menu.component';
import type { FilterOption } from './filter-menu.props';

// The menu is a custom sheet: press the anchor (its testID) to open, then each
// option is a shared `SelectableRow` checkbox at `${testID}-option-${value}`.
// Each row that carries an icon renders it as an SFSymbolView (mocked to a View
// under Jest) forwarding its `name`/`tintColor` props, so a glyph's native tint
// is read off the host node carrying that symbol name. The component returns a
// Fragment (anchor + sheet as siblings), so glyphs are searched from `container`
// — `root` would only cover the anchor, missing the sheet's Modal subtree.
const glyphTint = (utils: RenderResult, name: string): string | undefined =>
  utils.container.queryAll((node) => node.props.name === name).at(0)?.props.tintColor;

type MenuProps = {
  options?: FilterOption[];
  selected?: Set<string>;
  onToggle?: (value: string) => void;
};

const TEST_ID = 'filter-menu';

const renderMenu = (props: MenuProps = {}): ReturnType<typeof render> =>
  render(
    <FilterMenu
      label="Accounts"
      testID={TEST_ID}
      options={
        props.options ?? [
          { value: 'Monobank', icon: 'creditcard', color: '#34C759' },
          { value: 'PrivatBank', icon: 'building.columns', color: '#0A84FF' },
        ]
      }
      selected={props.selected ?? new Set<string>()}
      onToggle={props.onToggle ?? jest.fn()}
    />,
  );

const openMenu = async (getByTestId: (id: string) => unknown): Promise<void> => {
  await act(async () => {
    fireEvent.press(getByTestId(TEST_ID) as Parameters<typeof fireEvent.press>[0]);
  });
};

describe('FilterMenu', () => {
  it('renders each option row keyed on its value, plus the All row', async () => {
    const { getByTestId, queryByTestId } = await renderMenu();

    await openMenu(getByTestId);

    expect(queryByTestId(`${TEST_ID}-option-${FILTER_ALL}`)).toBeTruthy();
    expect(getByTestId(`${TEST_ID}-option-Monobank`)).toBeTruthy();
    expect(getByTestId(`${TEST_ID}-option-PrivatBank`)).toBeTruthy();
  });

  it('renders an option icon tinted with its color when provided', async () => {
    const utils = await renderMenu();

    await openMenu(utils.getByTestId);

    // Each unselected row's glyph reads in its own option color, passed straight
    // through to the native tintColor (toSFSymbolTintColor is a no-op on hex).
    expect(glyphTint(utils, 'creditcard')).toBe('#34C759');
    expect(glyphTint(utils, 'building.columns')).toBe('#0A84FF');
  });

  it('fills a selected option row with the accent surface', async () => {
    const { getByTestId } = await renderMenu({ selected: new Set(['Monobank']) });

    await openMenu(getByTestId);

    // Selecting a row now paints the FILLED accent surface (the shared
    // SelectableRow / OptionPills selection vocabulary), so a chosen filter
    // reads unambiguously blue instead of only carrying a checkmark; an
    // unselected row paints none.
    const selected = getByTestId(`${TEST_ID}-option-Monobank`);
    const unselected = getByTestId(`${TEST_ID}-option-PrivatBank`);

    expect(StyleSheet.flatten(selected.props.style).backgroundColor).toBe(darkTheme.colors.accent);
    expect(StyleSheet.flatten(unselected.props.style).backgroundColor).toBeUndefined();
  });

  it('routes an option press to onToggle with its value, not the icon/color', async () => {
    const onToggle = jest.fn();
    const { getByTestId } = await renderMenu({ onToggle });

    await openMenu(getByTestId);
    await act(async () => {
      fireEvent.press(getByTestId(`${TEST_ID}-option-PrivatBank`));
    });

    expect(onToggle).toHaveBeenCalledWith('PrivatBank');
  });

  it('marks a selected option checked by its value, unaffected by the icon', async () => {
    const { getByTestId } = await renderMenu({ selected: new Set(['Monobank']) });

    await openMenu(getByTestId);

    expect(getByTestId(`${TEST_ID}-option-Monobank`).props.accessibilityState?.checked).toBe(true);
    expect(getByTestId(`${TEST_ID}-option-PrivatBank`).props.accessibilityState?.checked).toBe(
      false,
    );
  });

  it('renders an icon-less option as a plain label, with no glyph for it', async () => {
    const { getByTestId, getByText } = await renderMenu({
      options: [{ value: 'Cash' }],
    });

    await openMenu(getByTestId);

    // The row still renders and stays selectable...
    const cashRow = getByTestId(`${TEST_ID}-option-Cash`);
    expect(cashRow).toBeTruthy();
    expect(getByText('Cash')).toBeTruthy();
    // ...but with no icon (and unselected, so no checkmark) it emits no glyph.
    expect(cashRow.queryAll((node) => node.props.name != null)).toHaveLength(0);
  });

  it('never renders an icon for the synthetic All row', async () => {
    const { getByTestId } = await renderMenu();

    await openMenu(getByTestId);

    // The All row reserves the icon slot (the menu has icon-bearing rows) but
    // never renders a glyph in it — only the leading checkmark when selected.
    const allRow = getByTestId(`${TEST_ID}-option-${FILTER_ALL}`);
    const glyphs = allRow.queryAll((node) => node.props.name != null);
    expect(glyphs.every((node) => node.props.name === 'checkmark')).toBe(true);
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('renders the synthetic All row label from the Ukrainian catalog, keeping the sentinel testID', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByTestId, getByText } = await renderMenu();

      await openMenu(getByTestId);

      expect(getByTestId(`${TEST_ID}-option-${FILTER_ALL}`)).toBeTruthy();
      expect(getByText('Усі')).toBeTruthy();
    });
  });
});
