import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';

import ColorPicker from './color-picker.component';

const { entityColors } = darkTheme.colors;

describe('ColorPicker', () => {
  it('renders a tappable swatch for every entity color', async () => {
    const { getByLabelText } = await render(
      <ColorPicker value={entityColors.white} onSelect={jest.fn()} />,
    );

    for (const name of Object.keys(entityColors)) {
      expect(getByLabelText(`Color ${name}`)).toBeTruthy();
    }
  });

  it('marks the swatch whose hex equals value as selected, and no other', async () => {
    const { getByLabelText } = await render(
      <ColorPicker value={entityColors.yellow} onSelect={jest.fn()} />,
    );

    expect(getByLabelText('Color yellow').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Color white').props.accessibilityState.selected).toBe(false);
  });

  it('reports the tapped swatch hex through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByLabelText } = await render(
      <ColorPicker value={entityColors.white} onSelect={onSelect} />,
    );

    await fireEvent.press(getByLabelText('Color violet'));

    expect(onSelect).toHaveBeenCalledWith(entityColors.violet);
  });

  it('renders an optional caption above the swatches', async () => {
    const { getByText } = await render(
      <ColorPicker value={entityColors.white} onSelect={jest.fn()} label="Color" />,
    );

    expect(getByText('Color')).toBeTruthy();
  });

  // Yoga resolves a percentage width in 32-bit float and wraps a line when the running width is
  // strictly greater than the row (see the day-of-month grid test, which replays the same math).
  // The rows below are the widths the picker lays out in: the outer display's form row
  // (466 - 84 tab bar - 2 x 32 padding), an iPhone form row, and an inner display pane row.
  describe('seven swatches to a row', () => {
    const COLUMNS = 7;
    const ROW_WIDTHS = [318, 390, 475];
    const RING_SIZE =
      darkTheme.spacing(7) +
      darkTheme.spacing(1) * 2 +
      // The ring's border, both sides (color-picker.styles.ts swatchRing).
      2 * 2;

    const cellWidthOf = async () => {
      const { getByLabelText } = await render(
        <ColorPicker value={entityColors.white} onSelect={jest.fn()} />,
      );

      return StyleSheet.flatten(getByLabelText('Color white').props.style).width;
    };

    // The running width after `count` cells on a row, as Yoga adds them.
    const consumedAfter = (count: number, percent: number, rowWidth: number) => {
      const row = Math.fround(rowWidth);
      const cell = Math.fround(Math.fround(Math.fround(percent) * row) * Math.fround(0.01));

      return Array.from({ length: count }).reduce<number>(
        (consumed) => Math.fround(consumed + cell),
        0,
      );
    };

    it('gives each swatch a seventh-minus-slack cell', async () => {
      expect(await cellWidthOf()).toBe('14.28%');
    });

    it.each(ROW_WIDTHS)('fits seven cells on a %s pt row', async (rowWidth) => {
      const percent = Number.parseFloat(String(await cellWidthOf()));

      expect(consumedAfter(COLUMNS, percent, rowWidth)).toBeLessThanOrEqual(Math.fround(rowWidth));
    });

    it('leaves each swatch ring room inside its cell on the narrowest row', async () => {
      const percent = Number.parseFloat(String(await cellWidthOf()));

      expect(consumedAfter(1, percent, ROW_WIDTHS[0])).toBeGreaterThanOrEqual(RING_SIZE);
    });

    // A palette that is not whole rows of seven leaves a short last row, and columns that sum past
    // a full row re-wrap: change the picker's layout together with the palette.
    it('keeps the palette at two whole rows and the columns under a full row', async () => {
      const percent = Number.parseFloat(String(await cellWidthOf()));

      expect(Object.keys(entityColors)).toHaveLength(COLUMNS * 2);
      expect(percent * COLUMNS).toBeLessThan(100);
    });

    it('centres the ring in its cell and spaces rows by a row gap only', async () => {
      const { getByLabelText } = await render(
        <ColorPicker value={entityColors.white} onSelect={jest.fn()} />,
      );
      const cell = StyleSheet.flatten(getByLabelText('Color white').props.style);
      const row = StyleSheet.flatten(getByLabelText('Color white').parent?.props.style);

      expect(cell.alignItems).toBe('center');
      expect(row.rowGap).toBe(darkTheme.spacing(2));
      expect(row.gap).toBeUndefined();
      expect(row.columnGap).toBeUndefined();
    });

    it('rings only the selected swatch', async () => {
      const { getByTestId } = await render(
        <ColorPicker value={entityColors.yellow} onSelect={jest.fn()} />,
      );

      expect(StyleSheet.flatten(getByTestId('color-ring-yellow').props.style).borderColor).toBe(
        darkTheme.colors.textPrimary,
      );
      expect(StyleSheet.flatten(getByTestId('color-ring-white').props.style).borderColor).toBe(
        'transparent',
      );
    });
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('falls back to the Ukrainian catalog for the accessibility-label prefix', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, queryByLabelText } = await render(
        <ColorPicker value={entityColors.white} onSelect={jest.fn()} />,
      );

      expect(getByLabelText('Колір white')).toBeTruthy();
      expect(queryByLabelText('Color white')).toBeNull();
    });
  });
});
