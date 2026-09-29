import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import type { TableCell } from '@kiko/statement-import/column-mapping';

import RawPreview from './raw-preview.component';

const rows: TableCell[][] = [
  ['Date', 'Description', 'Amount'],
  ['01.07.2025', 'Coffee', -123.45],
  ['02.07.2025', 'Salary', 5000],
];

const manyRows: TableCell[][] = Array.from({ length: 15 }, (_, index) => [`row-${index}`]);

describe('RawPreview', () => {
  it('renders every cell of every row, up to the first 5 rows', async () => {
    const { getByText } = await render(
      <RawPreview rows={rows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    expect(getByText('Date')).toBeTruthy();
    expect(getByText('Coffee')).toBeTruthy();
    expect(getByText('5000')).toBeTruthy();
  });

  it('caps the preview at the first 5 rows', async () => {
    const { queryByText } = await render(
      <RawPreview rows={manyRows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    expect(queryByText('row-4')).toBeTruthy();
    expect(queryByText('row-5')).toBeNull();
  });

  it('starts at row 0 before a header row is known', async () => {
    const { queryByText } = await render(
      <RawPreview rows={manyRows} headerRowIndex={undefined} onSelectHeaderRow={jest.fn()} />,
    );

    expect(queryByText('row-0')).toBeTruthy();
    expect(queryByText('row-4')).toBeTruthy();
    expect(queryByText('row-5')).toBeNull();
  });

  it('starts at the detected header row and shows 5 rows from it', async () => {
    const { queryByText } = await render(
      <RawPreview rows={manyRows} headerRowIndex={3} onSelectHeaderRow={jest.fn()} />,
    );

    expect(queryByText('row-2')).toBeNull();
    expect(queryByText('row-3')).toBeTruthy();
    expect(queryByText('row-7')).toBeTruthy();
    expect(queryByText('row-8')).toBeNull();
  });

  it('starts at a newly selected header row', async () => {
    const { queryByText, rerender } = await render(
      <RawPreview rows={manyRows} headerRowIndex={3} onSelectHeaderRow={jest.fn()} />,
    );

    await rerender(<RawPreview rows={manyRows} headerRowIndex={6} onSelectHeaderRow={jest.fn()} />);

    expect(queryByText('row-5')).toBeNull();
    expect(queryByText('row-6')).toBeTruthy();
    expect(queryByText('row-10')).toBeTruthy();
    expect(queryByText('row-11')).toBeNull();
  });

  it('keeps each shown row’s own file index as its tap target', async () => {
    const onSelectHeaderRow = jest.fn();
    const { getByTestId } = await render(
      <RawPreview rows={manyRows} headerRowIndex={3} onSelectHeaderRow={onSelectHeaderRow} />,
    );

    await fireEvent.press(getByTestId('raw-preview-row-5'));

    expect(onSelectHeaderRow).toHaveBeenCalledWith(5);
  });

  it('reveals every scanned row, including rows above the header, on Show all', async () => {
    const { getByTestId, queryByText } = await render(
      <RawPreview rows={manyRows} headerRowIndex={3} onSelectHeaderRow={jest.fn()} />,
    );

    await fireEvent.press(getByTestId('raw-preview-toggle'));

    expect(queryByText('row-0')).toBeTruthy();
    expect(queryByText('row-9')).toBeTruthy();
    expect(queryByText('row-10')).toBeNull();
    expect(
      within(getByTestId('raw-preview-toggle')).getByText(i18n.t('components.pieChart.showLess')),
    ).toBeTruthy();
    expect(getByTestId('raw-preview-toggle-chevron').props.name).toBe('chevron.up');
  });

  it('keeps the header’s own 5-row window when expanding from a header near the scan end', async () => {
    const { getByTestId, queryByText } = await render(
      <RawPreview rows={manyRows} headerRowIndex={8} onSelectHeaderRow={jest.fn()} />,
    );

    await fireEvent.press(getByTestId('raw-preview-toggle'));

    expect(queryByText('row-0')).toBeTruthy();
    expect(queryByText('row-12')).toBeTruthy();
    expect(queryByText('row-13')).toBeNull();
  });

  it('collapses back to 5 rows from the header on Show less', async () => {
    const { getByTestId, queryByText } = await render(
      <RawPreview rows={manyRows} headerRowIndex={3} onSelectHeaderRow={jest.fn()} />,
    );

    await fireEvent.press(getByTestId('raw-preview-toggle'));
    await fireEvent.press(getByTestId('raw-preview-toggle'));

    expect(queryByText('row-2')).toBeNull();
    expect(queryByText('row-3')).toBeTruthy();
    expect(queryByText('row-8')).toBeNull();
    expect(
      within(getByTestId('raw-preview-toggle')).getByText(i18n.t('components.pieChart.showAll')),
    ).toBeTruthy();
    expect(getByTestId('raw-preview-toggle-chevron').props.name).toBe('chevron.down');
  });

  it('selects a row above the header as the new header when expanded', async () => {
    const onSelectHeaderRow = jest.fn();
    const { getByTestId } = await render(
      <RawPreview rows={manyRows} headerRowIndex={3} onSelectHeaderRow={onSelectHeaderRow} />,
    );

    await fireEvent.press(getByTestId('raw-preview-toggle'));
    await fireEvent.press(getByTestId('raw-preview-row-1'));

    expect(onSelectHeaderRow).toHaveBeenCalledWith(1);
  });

  it('shows no toggle when every scanned row already fits', async () => {
    const { queryByTestId } = await render(
      <RawPreview rows={rows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    expect(queryByTestId('raw-preview-toggle')).toBeNull();
  });

  // The toggle sits alone below the grid, so vertical hitSlop can reach the
  // 44pt floor without overlapping a neighbouring target.
  it('gives the toggle at least a 44pt tap target', async () => {
    const { getByTestId } = await render(
      <RawPreview rows={manyRows} headerRowIndex={3} onSelectHeaderRow={jest.fn()} />,
    );

    const { StyleSheet } = require('react-native');
    const toggle = getByTestId('raw-preview-toggle');
    const { paddingVertical } = StyleSheet.flatten(toggle.props.style);
    const { top, bottom } = toggle.props.hitSlop;
    // The theme has no line-height token; the toggle's content row is at least
    // as tall as its caption-step chevron, so that size is a safe lower bound.
    const contentHeight = darkTheme.iconSizes.caption;

    expect(contentHeight + 2 * paddingVertical + top + bottom).toBeGreaterThanOrEqual(44);
  });

  it('calls onSelectHeaderRow with the tapped row index', async () => {
    const onSelectHeaderRow = jest.fn();
    const { getByTestId } = await render(
      <RawPreview rows={rows} headerRowIndex={0} onSelectHeaderRow={onSelectHeaderRow} />,
    );

    await fireEvent.press(getByTestId('raw-preview-row-1'));

    expect(onSelectHeaderRow).toHaveBeenCalledWith(1);
  });

  it('marks the currently selected header row', async () => {
    const { getByTestId } = await render(
      <RawPreview rows={rows} headerRowIndex={1} onSelectHeaderRow={jest.fn()} />,
    );

    expect(getByTestId('raw-preview-row-1').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('raw-preview-row-2').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('paints the selected header row with the theme accent blue', async () => {
    const { getByTestId } = await render(
      <RawPreview rows={rows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    const { StyleSheet } = require('react-native');
    const selectedFill = StyleSheet.flatten(getByTestId('raw-preview-row-0-fill').props.style);
    const unselectedFill = StyleSheet.flatten(getByTestId('raw-preview-row-1-fill').props.style);

    expect(selectedFill.backgroundColor).toBe(darkTheme.colors.accent);
    expect(unselectedFill.backgroundColor).toBeUndefined();
  });

  // The header-row tap target is the HIG 44pt floor, and the row height is a
  // locked visual (kiko-design-system), so a taller row is a regression too.
  it('gives each row exactly the 44pt HIG tap-target height', async () => {
    const { getByTestId } = await render(
      <RawPreview rows={rows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    const { StyleSheet } = require('react-native');
    const fill = StyleSheet.flatten(getByTestId('raw-preview-row-0-fill').props.style);

    expect(fill.minHeight).toBe(44);
  });

  // A wide export renders no more than 5 columns per row.
  it('shows at most 5 columns per row', async () => {
    const wideRows: TableCell[][] = [
      ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
    ];

    const { getByText, queryByText } = await render(
      <RawPreview rows={wideRows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    expect(getByText('c0')).toBeTruthy();
    expect(getByText('c4')).toBeTruthy();
    expect(queryByText('c5')).toBeNull();
    expect(queryByText('c6')).toBeNull();
  });

  // The selected header row's own cell text
  // turns semibold (600) — the app's selected-label weight everywhere else.
  it('renders the selected header row’s cell text semibold', async () => {
    const { getByText } = await render(
      <RawPreview rows={rows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    const { StyleSheet } = require('react-native');
    const selectedCellStyle = StyleSheet.flatten(getByText('Date').props.style);
    const unselectedCellStyle = StyleSheet.flatten(getByText('Coffee').props.style);

    expect(selectedCellStyle.fontWeight).toBe('600');
    expect(unselectedCellStyle.fontWeight).not.toBe('600');
  });
});
