import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import DayOfMonthGrid from '.';

// Text's tone -> color mapping is a unistyles variant the Jest mock strips, so
// the label's tone is read from the shared mock's testID instead.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  default: jest.requireActual('@kiko/test-support/mock-text-tone').default,
}));

const renderGrid = (selected = 1, onSelect = jest.fn()) =>
  render(
    <DayOfMonthGrid label="Day of month" selected={selected} onSelect={onSelect} testID="grid" />,
  );

describe('DayOfMonthGrid', () => {
  it('renders one button per day, 1 to 31 in order', async () => {
    const screen = await renderGrid();

    const labels = screen.getAllByRole('button').map((chip) => chip.props.accessibilityLabel);

    expect(labels).toEqual(Array.from({ length: 31 }, (_unused, index) => String(index + 1)));
  });

  it('reports the tapped day as a number', async () => {
    const onSelect = jest.fn();
    const screen = await renderGrid(1, onSelect);

    await fireEvent.press(screen.getByRole('button', { name: '31' }));

    expect(onSelect).toHaveBeenCalledWith(31);
  });

  it('exposes only the chosen day as selected, with the group name as every hint', async () => {
    const screen = await renderGrid(15);

    const chips = screen.getAllByRole('button');
    const selectedLabels = chips
      .filter((chip) => chip.props.accessibilityState?.selected === true)
      .map((chip) => chip.props.accessibilityLabel);

    expect(selectedLabels).toEqual(['15']);
    expect(new Set(chips.map((chip) => chip.props.accessibilityHint))).toEqual(
      new Set(['Day of month']),
    );
    expect(screen.getByLabelText('Day of month')).toBe(screen.getByTestId('grid'));
  });

  it('draws the chip look: accent under onAccent once selected, the faint neutral fill otherwise', async () => {
    const screen = await renderGrid(15);

    const selectedChip = within(screen.getByTestId('grid-option-15')).getByText('15');
    const otherChip = within(screen.getByTestId('grid-option-16')).getByText('16');

    expect(StyleSheet.flatten(selectedChip.parent?.props.style).backgroundColor).toBe(
      darkTheme.colors.accent,
    );
    expect(StyleSheet.flatten(otherChip.parent?.props.style).backgroundColor).toBe(
      darkTheme.colors.neutralSubtle,
    );
    expect(selectedChip.props.testID).toBe('text-tone-onAccent');
    expect(otherChip.props.testID).toBe('text-tone-textPrimary');
  });

  // Seven columns, like a month; each cell is a real 44pt box around a
  // compact 34pt chip, because grid neighbours leave no room for hitSlop.
  it('lays the days out seven to a row with a 44pt cell around a 34pt chip', async () => {
    const screen = await renderGrid();

    const cell = StyleSheet.flatten(screen.getByTestId('grid-option-1').props.style);
    const chip = StyleSheet.flatten(
      within(screen.getByTestId('grid-option-1')).getByText('1').parent?.props.style,
    );

    expect(cell.width).toBe(`${100 / 7}%`);
    expect(cell.minHeight).toBe(44);
    expect(chip.minHeight).toBe(34);
    expect(screen.getByTestId('grid-option-1').props.hitSlop).toBeUndefined();
  });
});
