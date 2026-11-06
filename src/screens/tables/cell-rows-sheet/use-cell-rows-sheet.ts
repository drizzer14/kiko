import maybe, { foldMap } from 'fnts/maybe';
import { useCallback, useMemo, useState } from 'react';
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

/**
 * What a table holds to show the rows behind a cell. It holds which cell was opened (its selector
 * and range), never the rows: the rows are computed from `rowsOf`, which the table builds from its
 * live ledger and rates, so a sync or a rate refresh moves the sheet's total with the cell. The
 * cell stays when the sheet is dismissed, so the closing animation does not show an empty sheet. A
 * native sheet stays presented over another tab, so a sheet opened in an earlier `sheetGeneration`
 * is hidden, never shown again by the remount that the new generation causes.
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

  const sheet = useMemo<Omit<CellRowsSheetProps, 'baseCurrency'> | undefined>(
    () =>
      foldMap(maybe(opened), ({ generation, title, selector, range, isOpen }) => ({
        visible: isOpen && generation === sheetGeneration,
        title,
        rows: rowsOf(selector, range),
        onDismiss: dismiss,
      })),
    [opened, sheetGeneration, rowsOf, dismiss],
  );

  return { open, sheet };
};
