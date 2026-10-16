import type { NetWorthPoint } from '@kiko/statistics/net-worth-series';

// The pure math behind the scrub line, kept free of any gesture object so it is unit-tested
// with plain numbers (the `bottom-sheet.gesture.ts` split); the component wires it into a Pan.

// The Pan claims the touch only after this much horizontal travel, and gives it up to the page
// scroll after this much vertical travel first, so a vertical swipe on the chart still scrolls.
export const SCRUB_ACTIVE_OFFSET_X = 10;
export const SCRUB_FAIL_OFFSET_Y = 10;

// The gap between the line and its label, in device pixels (two spacing units).
export const SCRUB_LABEL_GAP = 8;

export type ScrubSelection = { rangeKey: string; index: number };

type ScrubLabelPlacement = { side: 'right' | 'left' | 'clamped'; left: number };

// A touch's x in the chart's logical units, or `null` while the plot is not measured yet. The
// touch may be outside the plot: the finger can leave it mid-drag.
export const toLogicalX = (touchX: number, plotWidth: number, viewWidth: number): number | null => {
  if (plotWidth <= 0) {
    return null;
  }

  return (touchX * viewWidth) / plotWidth;
};

// The index of the point nearest to `x`. The strict comparison keeps the lower index on an exact
// tie and the first of duplicate xs; a clamp at both ends falls out of the distance itself.
export const nearestPointIndex = (pointXs: readonly number[], x: number): number =>
  pointXs.reduce(
    (nearest, pointX, index) =>
      Math.abs(pointX - x) < Math.abs(pointXs[nearest] - x) ? index : nearest,
    0,
  );

// Where the label sits against the line: on the right (facing into the plot) when it fits, else
// on the left, else centred on the line and clamped inside the plot.
export const placeScrubLabel = (
  lineX: number,
  labelWidth: number,
  plotWidth: number,
  gap: number,
): ScrubLabelPlacement => {
  if (lineX + gap + labelWidth <= plotWidth) {
    return { side: 'right', left: lineX + gap };
  }

  if (lineX - gap - labelWidth >= 0) {
    return { side: 'left', left: lineX - gap - labelWidth };
  }

  return {
    side: 'clamped',
    left: Math.min(Math.max(lineX - labelWidth / 2, 0), Math.max(plotWidth - labelWidth, 0)),
  };
};

// The identity of the plotted range: a period change moves the first or last `t`, while a live
// amount update or backfill progress changes neither.
export const scrubRangeKey = (points: readonly NetWorthPoint[]): string =>
  String(points[0].t).concat(':', String(points[points.length - 1].t), ':', String(points.length));

// The selected index, derived on every render so a stale selection never needs a reset effect:
// the present day (the last point) unless a selection exists for the current range.
export const resolveScrubIndex = (
  selection: ScrubSelection | null,
  points: readonly NetWorthPoint[],
): number => {
  const lastIndex = points.length - 1;

  if (selection === null || selection.rangeKey !== scrubRangeKey(points)) {
    return lastIndex;
  }

  return Math.min(Math.max(selection.index, 0), lastIndex);
};

// One accessibility step (a VoiceOver swipe up or down) along the points, clamped at both ends.
export const stepScrubIndex = (index: number, delta: 1 | -1, count: number): number =>
  Math.min(Math.max(index + delta, 0), count - 1);
