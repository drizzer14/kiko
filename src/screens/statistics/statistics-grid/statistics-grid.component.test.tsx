import { View } from 'react-native';
import { render, within } from '@testing-library/react-native';
import { testIdsInOrder } from '@kiko/test-support/test-ids-in-order';

import '@kiko/design-system/unistyles';

import StatisticsGrid from '.';
import type { GridColumns } from './grid-columns';

const LEAD = <View testID="lead" />;
const CARDS = ['bar', 'pie', 'category', 'trend'].map((name) => <View key={name} testID={name} />);

const CELL_IDS = ['lead', 'bar', 'pie', 'category', 'trend'];

const renderGrid = (columns: GridColumns) =>
  render(
    <View testID="root">
      <StatisticsGrid columns={columns} lead={LEAD} cards={CARDS} />
    </View>,
  );

const cellsOf = (view: Awaited<ReturnType<typeof renderGrid>>) =>
  testIdsInOrder(view.toJSON()).filter((id) => CELL_IDS.includes(id));

describe('StatisticsGrid', () => {
  it('renders the lead and the cards in order with no row at one column', async () => {
    const view = await renderGrid(1);

    expect(cellsOf(view)).toEqual(CELL_IDS);
    expect(view.queryAllByTestId('statistics-grid-row')).toHaveLength(0);
    expect(view.queryAllByTestId('statistics-grid-spacer')).toHaveLength(0);
  });

  it.each<[GridColumns, string[][], number]>([
    [
      2,
      [
        ['bar', 'pie'],
        ['category', 'trend'],
      ],
      0,
    ],
    [3, [['bar', 'pie', 'category'], ['trend']], 2],
  ])(
    'renders the lead first and outside any row, then the cards by row, at %d columns',
    async (columns, expectedRows, spacers) => {
      const view = await renderGrid(columns);
      const rows = view.getAllByTestId('statistics-grid-row');

      expect(cellsOf(view)).toEqual(CELL_IDS);
      expect(rows.map((row) => CELL_IDS.filter((id) => within(row).queryByTestId(id)))).toEqual(
        expectedRows,
      );
      expect(view.queryAllByTestId('statistics-grid-spacer')).toHaveLength(spacers);
    },
  );

  it.each([2, 3] as const)(
    'renders at %d columns without a duplicate or missing key warning',
    async (columns) => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await renderGrid(columns);

        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    },
  );
});
