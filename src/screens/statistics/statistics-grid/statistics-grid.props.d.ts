import type { ReactElement } from 'react';

export type StatisticsGridProps = {
  /** Whether the two shared cards sit side by side in one row; otherwise the grid adds no row. */
  isRowShared: boolean;
  /** The cards that are one per row at their own height, in order; each carries its own key. */
  fullWidth: readonly ReactElement[];
  /** The two cards that share a row where there is room, in order; each carries its own key. */
  shared: readonly [ReactElement, ReactElement];
};
