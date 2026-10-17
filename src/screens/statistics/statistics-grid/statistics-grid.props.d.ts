import type { ReactElement } from 'react';

import type { GridColumns } from './grid-columns';

export type StatisticsGridProps = {
  /** How many cards sit side by side; at one column the grid adds no row at all. */
  columns: GridColumns;
  /** The net worth over time card, always the full-width first row. */
  lead: ReactElement;
  /** The rest of the cards, in order; each carries its own React key. */
  cards: readonly ReactElement[];
};
