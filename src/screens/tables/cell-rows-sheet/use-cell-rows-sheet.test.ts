import { Money } from '@kiko/currency/money';
import { act, renderHook } from '@testing-library/react-native';
import type { CellRange, CellRow } from '@kiko/statistics/cell-rows';

import { useCellRowsSheet } from './use-cell-rows-sheet';

const rowOf = (id: string, minorUnits: number): CellRow => ({
  id,
  transactionId: id,
  time: 1,
  description: id,
  native: Money.of('UAH', minorUnits),
  base: Money.of('UAH', minorUnits),
  category: null,
  accountName: '',
  holdingType: null,
  loanHoldingId: null,
  flow: 'expense',
});

const COFFEE = rowOf('coffee', 1_500);
const BREAD = rowOf('bread', 4_000);
const JANUARY: CellRange = { start: 10, end: 20 };

type Rows = (selector: string, range: CellRange) => readonly CellRow[];
type Props = { generation: number; rowsOf: Rows };

const rowsOf: Rows = () => [COFFEE];

const onOpenTransaction = jest.fn();

const hookOf = () =>
  renderHook<ReturnType<typeof useCellRowsSheet<string>>, Props>(
    ({ generation, rowsOf: current }) => useCellRowsSheet(generation, current, onOpenTransaction),
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
      useCellRowsSheet<string>(
        0,
        (selector, range) => {
          seen.push([selector, range]);

          return [];
        },
        onOpenTransaction,
      ),
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

  // The sheet is a native Modal, so a form pushed while it is up shows behind it: the press holds
  // the transaction and the sheet's own close, once finished, opens it.
  describe('a row press', () => {
    const openedHook = async () => {
      const hook = await hookOf();

      await act(async () => {
        hook.result.current.open('Groceries, January 2025', 'groceries', JANUARY);
      });

      return hook;
    };

    const press = async (hook: Awaited<ReturnType<typeof hookOf>>, row: CellRow) => {
      await act(async () => {
        hook.result.current.sheet?.onPressRow(row);
      });
    };

    const closed = async (hook: Awaited<ReturnType<typeof hookOf>>) => {
      await act(async () => {
        hook.result.current.sheet?.onClosed();
      });
    };

    it('hides the sheet on a row press and opens nothing until it has closed', async () => {
      const hook = await openedHook();

      await press(hook, COFFEE);

      expect(hook.result.current.sheet?.visible).toBe(false);
      expect(onOpenTransaction).not.toHaveBeenCalled();
    });

    it("opens the pressed row's transaction once the sheet has closed", async () => {
      const hook = await openedHook();
      const payment = { ...COFFEE, id: 'loan-interest:payment', transactionId: 'payment' };

      await press(hook, payment);
      await closed(hook);

      expect(onOpenTransaction).toHaveBeenCalledTimes(1);
      expect(onOpenTransaction).toHaveBeenCalledWith('payment');
    });

    it('opens it once, not again on a later close', async () => {
      const hook = await openedHook();

      await press(hook, COFFEE);
      await closed(hook);
      await closed(hook);

      expect(onOpenTransaction).toHaveBeenCalledTimes(1);
    });

    it('opens nothing when the sheet closes by a dismiss', async () => {
      const hook = await openedHook();

      await act(async () => {
        hook.result.current.sheet?.onDismiss();
      });
      await closed(hook);

      expect(onOpenTransaction).not.toHaveBeenCalled();
    });

    it('opens nothing for a press held from before the cell was opened again', async () => {
      const hook = await openedHook();

      await press(hook, COFFEE);
      await act(async () => {
        hook.result.current.open('Groceries, February 2025', 'groceries', JANUARY);
      });
      await closed(hook);

      expect(onOpenTransaction).not.toHaveBeenCalled();
    });

    it('opens the last pressed row when two are pressed before the sheet closes', async () => {
      const hook = await openedHook();

      await press(hook, COFFEE);
      await press(hook, BREAD);
      await closed(hook);

      expect(onOpenTransaction).toHaveBeenCalledTimes(1);
      expect(onOpenTransaction).toHaveBeenCalledWith('bread');
    });
  });
});
