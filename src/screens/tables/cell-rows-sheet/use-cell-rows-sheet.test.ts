import { Money } from '@kiko/currency/money';
import type { CellRow } from '@kiko/statistics/cell-rows';
import { act, renderHook } from '@testing-library/react-native';

import { useCellRowsSheet } from './use-cell-rows-sheet';

const ROWS: CellRow[] = [
  {
    id: 'coffee',
    time: 1,
    description: 'Coffee',
    native: Money.of('UAH', 1_500),
    base: Money.of('UAH', 1_500),
  },
];

type Generation = { generation: number };

const hookOf = () =>
  renderHook<ReturnType<typeof useCellRowsSheet>, Generation>(
    ({ generation }) => useCellRowsSheet(generation),
    { initialProps: { generation: 0 } },
  );

describe('useCellRowsSheet', () => {
  it('has no sheet before a cell is opened', async () => {
    const { result } = await hookOf();

    expect(result.current.sheet).toBeUndefined();
  });

  it('shows the rows of the cell it is told to open', async () => {
    const { result } = await hookOf();

    await act(async () => {
      result.current.open('Groceries, January 2025', ROWS);
    });

    expect(result.current.sheet).toMatchObject({
      visible: true,
      title: 'Groceries, January 2025',
    });
    expect(result.current.sheet?.rows).toEqual(ROWS);
  });

  it('hides the sheet on a dismiss and keeps its rows for the closing animation', async () => {
    const { result } = await hookOf();

    await act(async () => {
      result.current.open('Groceries, January 2025', ROWS);
    });
    await act(async () => {
      result.current.sheet?.onDismiss();
    });

    expect(result.current.sheet?.visible).toBe(false);
    expect(result.current.sheet?.rows).toEqual(ROWS);
  });

  it('hides the sheet when the generation moves on, and shows it when opened again', async () => {
    const { result, rerender } = await hookOf();

    await act(async () => {
      result.current.open('Groceries, January 2025', ROWS);
    });
    await rerender({ generation: 1 });

    expect(result.current.sheet?.visible).toBe(false);

    await act(async () => {
      result.current.open('Groceries, January 2025', ROWS);
    });

    expect(result.current.sheet?.visible).toBe(true);
  });
});
