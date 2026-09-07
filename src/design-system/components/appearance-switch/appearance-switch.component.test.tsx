import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import '../../../i18n';

import AppearanceSwitch from '.';

describe('AppearanceSwitch', () => {
  it('reports the pressed appearance through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(<AppearanceSwitch selected="system" onSelect={onSelect} />);

    await fireEvent.press(getByText('Dark'));

    expect(onSelect).toHaveBeenCalledWith('dark');
  });

  it('renders all three appearance pills', async () => {
    const { getByText } = await render(<AppearanceSwitch selected="system" onSelect={jest.fn()} />);

    expect(getByText('System')).toBeTruthy();
    expect(getByText('Light')).toBeTruthy();
    expect(getByText('Dark')).toBeTruthy();
  });

  it('marks the selected appearance via accessibilityState', async () => {
    const { getByText } = await render(<AppearanceSwitch selected="light" onSelect={jest.fn()} />);

    expect(getByText('Light').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('System').parent?.props.accessibilityState.selected).toBe(false);
  });

  // OptionPills defaults to an always-2-column grid, which would leave this
  // control's 3rd pill alone on its own row. AppearanceSwitch opts into a
  // single equal-width row via `columns={appearances.length}` (3) — assert
  // each pill's cell actually gets a 33.33%-ish width, not the 50% default.
  it('lays out all three pills in a single row (equal-width cells, not the 2-column default)', async () => {
    const { getByText } = await render(<AppearanceSwitch selected="system" onSelect={jest.fn()} />);

    // The cell View is the pill Pressable's grandparent (Pressable -> cell View).
    const cellStyle = getByText('System').parent?.parent?.props.style;
    const flattened = Array.isArray(cellStyle) ? Object.assign({}, ...cellStyle) : cellStyle;

    expect(flattened.width).toBe(`${100 / 3}%`);
  });
});
