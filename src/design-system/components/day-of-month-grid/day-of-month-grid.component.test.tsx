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

  // Replays Yoga's line-wrap math (32-bit float percentage, strict `>` against
  // the row) because an exact 100/7 overshoots on common widths and the grid
  // silently falls to six columns on device, which Jest's layout never shows.
  it('keeps seven cells on one row at every point width under float rounding', async () => {
    const screen = await renderGrid();

    const cellWidth = StyleSheet.flatten(screen.getByTestId('grid-option-1').props.style).width;
    const percent = Math.fround(Number.parseFloat(String(cellWidth)));
    const rowWidths = Array.from({ length: 1201 * 3 }, (_unused, index) => 200 + index / 3);
    const wrapsBeforeSeventh = (rowWidth: number) => {
      const row = Math.fround(rowWidth);
      const cell = Math.fround(Math.fround(percent * row) * Math.fround(0.01));
      let consumed = Math.fround(0);

      return Array.from({ length: 7 }).some(() => {
        consumed = Math.fround(consumed + cell);

        return consumed > row;
      });
    };

    expect(rowWidths.filter(wrapsBeforeSeventh)).toEqual([]);
  });
});
