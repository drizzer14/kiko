import maybe, { foldMap } from 'fnts/maybe';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { CellRange, CellRow } from '@kiko/statistics/cell-rows';

import type { CellRowsSheetProps } from './cell-rows-sheet.props';

type Opened<Selector> = {
  /** The screen's `sheetGeneration` when the cell was opened. */
  generation: number;
  title: string;
  selector: Selector;
  range: CellRange;
  isOpen: boolean;
};

// Compared row by row, not by array identity, so the shown rows are set again only when a row
// changed. It settles only while the rows keep their identity across renders.
const sameRows = (first: readonly CellRow[], second: readonly CellRow[]) =>
  first.length === second.length && first.every((row, index) => row === second[index]);

/**
 * What a table holds to show the rows behind a cell. It holds which cell was opened (its selector
 * and range), never the rows: the rows are computed from `rowsOf`, which the table builds from its
 * live ledger and rates, so a sync or a rate refresh moves the sheet's total with the cell. The
 * rows are computed only while the sheet is visible; a hidden sheet keeps the rows it last showed,
 * so the closing animation does not show an empty sheet and a ledger change while it is hidden
 * costs nothing. A native sheet stays presented over another tab, so a sheet opened in an earlier
 * `sheetGeneration` is hidden, never shown again by the remount that the new generation causes.
 *
 * A press on a row hides the sheet and holds the row's transaction; the sheet's `onClosed`, which
 * fires once its close has finished, hands it to `onOpenTransaction`, since a screen pushed while a
 * native sheet is up would show behind it. A dismiss with no press opens nothing, and so does a
 * press held from before the cell was opened again. No generation check is needed: the remount that
 * a new generation causes drops the sheet's Modal, which then fires no close.
 */
export const useCellRowsSheet = <Selector>(
  sheetGeneration: number,
  rowsOf: (selector: Selector, range: CellRange) => readonly CellRow[],
  onOpenTransaction: (transactionId: string) => void,
) => {
  const [opened, setOpened] = useState<Opened<Selector>>();
  const pressedRef = useRef<{ transactionId: string } | undefined>(undefined);

  const open = useCallback(
    (title: string, selector: Selector, range: CellRange) => {
      pressedRef.current = undefined;
      setOpened({ generation: sheetGeneration, title, selector, range, isOpen: true });
    },
    [sheetGeneration],
  );

  const dismiss = useCallback(() => {
    setOpened((held) => foldMap(maybe(held), (current) => ({ ...current, isOpen: false })));
  }, []);

  const pressRow = useCallback(
    (row: CellRow) => {
      pressedRef.current = { transactionId: row.transactionId };
      dismiss();
    },
    [dismiss],
  );

  const onClosed = useCallback(() => {
    const pressed = pressedRef.current;

    pressedRef.current = undefined;
    foldMap(maybe(pressed), ({ transactionId }) => onOpenTransaction(transactionId));
  }, [onOpenTransaction]);

  const visible = opened?.isOpen === true && opened.generation === sheetGeneration;
  const liveRows = useMemo(
    () => (visible && opened ? rowsOf(opened.selector, opened.range) : undefined),
    [visible, opened, rowsOf],
  );

  const [shownRows, setShownRows] = useState<readonly CellRow[]>([]);

  if (liveRows && !sameRows(liveRows, shownRows)) {
    setShownRows(liveRows);
  }

  const rows = liveRows ?? shownRows;

  const sheet = useMemo<Omit<CellRowsSheetProps, 'baseCurrency'> | undefined>(
    () =>
      foldMap(maybe(opened), ({ title }) => ({
        visible,
        title,
        rows,
        onDismiss: dismiss,
        onPressRow: pressRow,
        onClosed,
      })),
    [opened, visible, rows, dismiss, pressRow, onClosed],
  );

  return { open, sheet };
};
