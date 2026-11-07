import maybe, { foldMap } from 'fnts/maybe';
import type { CellRange, CellRow } from '@kiko/statistics/cell-rows';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CellRowsSheetProps } from './cell-rows-sheet.props';

type Opened<Selector> = {
  /** The screen's `sheetGeneration` when the cell was opened. */
  generation: number;
  title: string;
  selector: Selector;
  range: CellRange;
  isOpen: boolean;
};

/**
 * What a table holds to show the rows behind a cell. It holds which cell was opened (its selector
 * and range), never the rows: the rows are computed from `rowsOf`, which the table builds from its
 * live ledger and rates, so a sync or a rate refresh moves the sheet's total with the cell. The
 * rows are computed only while the sheet is visible; a hidden sheet keeps the rows it last showed,
 * so the closing animation does not show an empty sheet and a ledger change while it is hidden
 * costs nothing. A native sheet stays presented over another tab, so a sheet opened in an earlier
 * `sheetGeneration` is hidden, never shown again by the remount that the new generation causes.
 */
export const useCellRowsSheet = <Selector>(
  sheetGeneration: number,
  rowsOf: (selector: Selector, range: CellRange) => readonly CellRow[],
) => {
  const [opened, setOpened] = useState<Opened<Selector>>();

  const open = useCallback(
    (title: string, selector: Selector, range: CellRange) => {
      setOpened({ generation: sheetGeneration, title, selector, range, isOpen: true });
    },
    [sheetGeneration],
  );

  const dismiss = useCallback(() => {
    setOpened((held) => foldMap(maybe(held), (current) => ({ ...current, isOpen: false })));
  }, []);

  const visible = opened?.isOpen === true && opened.generation === sheetGeneration;
  const liveRows = useMemo(
    () => (visible && opened ? rowsOf(opened.selector, opened.range) : undefined),
    [visible, opened, rowsOf],
  );

  const lastRows = useRef<readonly CellRow[]>([]);
  useEffect(() => {
    if (liveRows) {
      lastRows.current = liveRows;
    }
  }, [liveRows]);
  const rows = liveRows ?? lastRows.current;

  const sheet = useMemo<Omit<CellRowsSheetProps, 'baseCurrency'> | undefined>(
    () => foldMap(maybe(opened), ({ title }) => ({ visible, title, rows, onDismiss: dismiss })),
    [opened, visible, rows, dismiss],
  );

  return { open, sheet };
};
