import maybe, { foldMap } from 'fnts/maybe';
import { useCallback, useState } from 'react';
import type { CellRow } from '@kiko/statistics/cell-rows';

import type { CellRowsSheetProps } from './cell-rows-sheet.props';

type Opened = {
  /** The screen's `sheetGeneration` when the cell was opened. */
  generation: number;
  title: string;
  rows: readonly CellRow[];
  isOpen: boolean;
};

/**
 * What a table holds to show the rows behind a cell. The rows stay when the sheet is dismissed, so
 * the closing animation does not show an empty sheet. A native sheet stays presented over another
 * tab, so a sheet opened in an earlier `sheetGeneration` is hidden, never shown again by the
 * remount that the new generation causes.
 */
export const useCellRowsSheet = (sheetGeneration: number) => {
  const [opened, setOpened] = useState<Opened>();

  const open = useCallback(
    (title: string, rows: readonly CellRow[]) => {
      setOpened({ generation: sheetGeneration, title, rows, isOpen: true });
    },
    [sheetGeneration],
  );

  const dismiss = useCallback(() => {
    setOpened((held) => foldMap(maybe(held), (current) => ({ ...current, isOpen: false })));
  }, []);

  const sheet: Omit<CellRowsSheetProps, 'baseCurrency'> | undefined = foldMap(
    maybe(opened),
    ({ generation, title, rows, isOpen }) => ({
      visible: isOpen && generation === sheetGeneration,
      title,
      rows,
      onDismiss: dismiss,
    }),
  );

  return { open, sheet };
};
