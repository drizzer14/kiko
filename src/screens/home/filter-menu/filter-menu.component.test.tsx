import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import FilterMenu, { FILTER_ALL } from './filter-menu.component';
import type { FilterOption } from './filter-menu.props';

// The menu is a custom sheet: press the anchor (its testID) to open, then each
// option is a checkbox row at `${testID}-option-${value}`. Every option that
// carries an icon renders it as an SFSymbolView (mocked to a View under Jest)
// labeled with the option's own `value`, so `getByLabelText(value)` reads that
// glyph's `name`/`tintColor` props.
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
    const { getByTestId, getByLabelText } = await renderMenu();

    await openMenu(getByTestId);

    // The icon is labeled with the option's value; its color is a hex, passed
    // through to the native tintColor unchanged (toSFSymbolTintColor is a no-op
    // on hex).
    expect(getByLabelText('Monobank').props.name).toBe('creditcard');
    expect(getByLabelText('Monobank').props.tintColor).toBe('#34C759');
    expect(getByLabelText('PrivatBank').props.name).toBe('building.columns');
    expect(getByLabelText('PrivatBank').props.tintColor).toBe('#0A84FF');
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
    const { getByTestId, getByText, queryByLabelText } = await renderMenu({
      options: [{ value: 'Cash' }],
    });

    await openMenu(getByTestId);

    // The row still renders and stays selectable...
    expect(getByTestId(`${TEST_ID}-option-Cash`)).toBeTruthy();
    expect(getByText('Cash')).toBeTruthy();
    // ...but with no icon, no labeled glyph is emitted for it.
    expect(queryByLabelText('Cash')).toBeNull();
  });

  it('never renders an icon for the synthetic All row', async () => {
    const { getByTestId, queryByLabelText } = await renderMenu();

    await openMenu(getByTestId);

    expect(queryByLabelText(FILTER_ALL)).toBeNull();
  });
});
