/** Zero inside an extent, and otherwise the gap to its nearer end. */
export const gapBetween = (time: number, start: number, end: number): number =>
  Math.max(start - time, time - end, 0);
