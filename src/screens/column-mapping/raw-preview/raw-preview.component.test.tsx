import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';

import { darkTheme } from '../../../design-system/theme';
import type { TableCell } from '../../../statement-import/column-mapping';

import RawPreview from './raw-preview.component';

const rows: TableCell[][] = [
  ['Date', 'Description', 'Amount'],
  ['01.07.2025', 'Coffee', -123.45],
  ['02.07.2025', 'Salary', 5000],
];

describe('RawPreview', () => {
  it('renders every cell of every row, up to the first 10 rows', async () => {
    const { getByText } = await render(
      <RawPreview rows={rows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    expect(getByText('Date')).toBeTruthy();
    expect(getByText('Coffee')).toBeTruthy();
    expect(getByText('5000')).toBeTruthy();
  });

  it('caps the preview at the first 10 rows', async () => {
    const manyRows: TableCell[][] = Array.from({ length: 15 }, (_, index) => [`row-${index}`]);

    const { queryByText } = await render(
      <RawPreview rows={manyRows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    expect(queryByText('row-9')).toBeTruthy();
    expect(queryByText('row-10')).toBeNull();
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
    expect(getByTestId('raw-preview-row-0').props.accessibilityState).toEqual({
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
});
