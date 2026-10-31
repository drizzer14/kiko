import type { ReactElement } from 'react';

export type StatisticsGridProps = {
  /** Whether the two shared cards sit side by side in one row; otherwise the grid adds no row. */
  isRowShared: boolean;
  /** The cards that are one per row at their own height, in order; each carries its own key. */
  fullWidth: readonly ReactElement[];
  /**
   * The cards that share a row where there is room, in order, each with its own key; none in a
   * window that is not large, where every card is in `fullWidth`.
   */
  shared: readonly ReactElement[];
};
