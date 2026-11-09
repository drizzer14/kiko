import { Money } from '@kiko/currency/money';
import { act, renderHook } from '@testing-library/react-native';
import type { CellRange, CellRow } from '@kiko/statistics/cell-rows';

import { useCellRowsSheet } from './use-cell-rows-sheet';

const rowOf = (id: string, minorUnits: number): CellRow => ({
  id,
  time: 1,
  description: id,
  native: Money.of('UAH', minorUnits),
  base: Money.of('UAH', minorUnits),
});

const COFFEE = rowOf('coffee', 1_500);
const BREAD = rowOf('bread', 4_000);
const JANUARY: CellRange = { start: 10, end: 20 };

type Rows = (selector: string, range: CellRange) => readonly CellRow[];
type Props = { generation: number; rowsOf: Rows };

const rowsOf: Rows = () => [COFFEE];

const hookOf = () =>
  renderHook<ReturnType<typeof useCellRowsSheet<string>>, Props>(
    ({ generation, rowsOf: current }) => useCellRowsSheet(generation, current),
    { initialProps: { generation: 0, rowsOf } },
  );

describe('useCellRowsSheet', () => {
  it('has no sheet before a cell is opened', async () => {
    const { result } = await hookOf();

    expect(result.current.sheet).toBeUndefined();
  });

  it('shows the rows of the cell it is told to open', async () => {
    const { result } = await hookOf();

    await act(async () => {
      result.current.open('Groceries, January 2025', 'groceries', JANUARY);
    });

    expect(result.current.sheet).toMatchObject({
      visible: true,
      title: 'Groceries, January 2025',
    });
    expect(result.current.sheet?.rows).toEqual([COFFEE]);
  });

  it('asks for the rows of the selector and the range of the cell it opened', async () => {
    const seen: [string, CellRange][] = [];
    const { result } = await renderHook(() =>
      useCellRowsSheet<string>(0, (selector, range) => {
        seen.push([selector, range]);

        return [];
      }),
    );

    await act(async () => {
      result.current.open('Groceries, January 2025', 'groceries', JANUARY);
    });

    expect(seen.at(-1)).toEqual(['groceries', JANUARY]);
  });

  it('follows the live rows while the sheet is open', async () => {
    const { result, rerender } = await hookOf();

    await act(async () => {
      result.current.open('Groceries, January 2025', 'groceries', JANUARY);
    });
    await rerender({ generation: 0, rowsOf: () => [COFFEE, BREAD] });

    expect(result.current.sheet?.rows).toEqual([COFFEE, BREAD]);
  });

  it('hides the sheet on a dismiss and keeps its rows for the closing animation', async () => {
    const { result } = await hookOf();

    await act(async () => {
      result.current.open('Groceries, January 2025', 'groceries', JANUARY);
    });
    await act(async () => {
      result.current.sheet?.onDismiss();
    });

    expect(result.current.sheet?.visible).toBe(false);
    expect(result.current.sheet?.rows).toEqual([COFFEE]);
  });

  it('does not compute the rows while the sheet is hidden, and keeps the last ones', async () => {
    const { result, rerender } = await hookOf();

    await act(async () => {
      result.current.open('Groceries, January 2025', 'groceries', JANUARY);
    });
    await act(async () => {
      result.current.sheet?.onDismiss();
    });

    const whileHidden = jest.fn<readonly CellRow[], [string, CellRange]>(() => [COFFEE, BREAD]);

    await rerender({ generation: 0, rowsOf: whileHidden });

    expect(whileHidden).not.toHaveBeenCalled();
    expect(result.current.sheet?.rows).toEqual([COFFEE]);
  });

  it('computes the rows afresh when a dismissed sheet is opened again', async () => {
    const { result, rerender } = await hookOf();

    await act(async () => {
      result.current.open('Groceries, January 2025', 'groceries', JANUARY);
    });
    await act(async () => {
      result.current.sheet?.onDismiss();
    });
    await rerender({ generation: 0, rowsOf: () => [COFFEE, BREAD] });
    await act(async () => {
      result.current.open('Groceries, January 2025', 'groceries', JANUARY);
    });

    expect(result.current.sheet?.rows).toEqual([COFFEE, BREAD]);
  });

  it('hides the sheet when the generation moves on, and shows it when opened again', async () => {
    const { result, rerender } = await hookOf();

    await act(async () => {
      result.current.open('Groceries, January 2025', 'groceries', JANUARY);
    });
    await rerender({ generation: 1, rowsOf });

    expect(result.current.sheet?.visible).toBe(false);

    await act(async () => {
      result.current.open('Groceries, January 2025', 'groceries', JANUARY);
    });

    expect(result.current.sheet?.visible).toBe(true);
  });
});
