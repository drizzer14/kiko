import type { FoldRegion, LayoutMode } from '@kiko/display-regions';

export type PaneFrame = { x: number; y: number; width: number; height: number };

type PaneGeometry = {
  companion: PaneFrame;
  primary: PaneFrame;
  divider: PaneFrame;
  isFolded: boolean;
};

type Window = { width: number; height: number };
type Fold = NonNullable<FoldRegion>;
type SplitMode = Exclude<LayoutMode, 'single'>;

type Axis = {
  windowLength: (window: Window) => number;
  foldStart: (fold: Fold) => number;
  foldLength: (fold: Fold) => number;
  // Whether the fold is oriented along the axis the panes do not split (tall for columns, wide for
  // rows), which is the only fold that can sit between two panes of this mode. Its orientation
  // alone decides it: the fold and the window arrive separately and a size comparison against the
  // window would flip on a fraction of a point.
  foldRunsAlongCrossAxis: (fold: Fold) => boolean;
  frame: (window: Window, start: number, length: number) => PaneFrame;
};

const AXES: Record<SplitMode, Axis> = {
  columns: {
    windowLength: (window) => window.width,
    foldStart: (fold) => fold.x,
    foldLength: (fold) => fold.width,
    foldRunsAlongCrossAxis: (fold) => fold.height > fold.width,
    frame: (window, start, length) => ({ x: start, y: 0, width: length, height: window.height }),
  },
  rows: {
    windowLength: (window) => window.height,
    foldStart: (fold) => fold.y,
    foldLength: (fold) => fold.height,
    foldRunsAlongCrossAxis: (fold) => fold.width > fold.height,
    frame: (window, start, length) => ({ x: 0, y: start, width: window.width, height: length }),
  },
};

const clamp = (value: number, lowest: number, highest: number) =>
  Math.min(Math.max(value, lowest), highest);

const moveBelowBand = (frame: PaneFrame, band: number): PaneFrame =>
  frame.y === 0 ? { ...frame, y: band, height: frame.height - band } : frame;

/**
 * The geometry with every frame that touches the window top moved below the top-bar band (both
 * panes and the divider in columns, the companion in rows). A band of 0 changes nothing.
 */
export const belowTopBand = (geometry: PaneGeometry, band: number): PaneGeometry =>
  band === 0
    ? geometry
    : {
        ...geometry,
        companion: moveBelowBand(geometry.companion, band),
        divider: moveBelowBand(geometry.divider, band),
        primary: moveBelowBand(geometry.primary, band),
      };

/**
 * The frame of the layer over both panes: the window below the top-bar band, which the layer's
 * native header must not sit behind.
 */
export const wholeWindowFrame = (window: Window, band: number): PaneFrame => ({
  x: 0,
  y: band,
  width: window.width,
  height: window.height - band,
});

// Pure pane geometry. Flat: the companion takes `companionShare` of the length less the hairline
// divider. Folded: each pane ends at the fold edge, so the panes are equal only when the fold is
// centred. A fold ignores the share. The divider is then the fold's own gap, which the caller does
// not draw. A fold not oriented along the mode's cross axis is a transient from a rotation (the
// window and the fold arrive separately), so it counts as flat.
export const resolvePaneGeometry = (
  mode: SplitMode,
  window: Window,
  fold: FoldRegion,
  hairline: number,
  companionShare: number,
): PaneGeometry => {
  const axis = AXES[mode];
  const length = axis.windowLength(window);
  const isFolded = fold !== null && axis.foldRunsAlongCrossAxis(fold);
  // The fold's extent is clamped into the window so a fold that overhangs never makes a pane
  // negative.
  const start = isFolded
    ? clamp(axis.foldStart(fold), 0, length)
    : (length - hairline) * companionShare;
  const gap = isFolded
    ? clamp(axis.foldStart(fold) + axis.foldLength(fold), start, length) - start
    : hairline;
  const end = start + gap;

  return {
    companion: axis.frame(window, 0, start),
    divider: axis.frame(window, start, gap),
    primary: axis.frame(window, end, length - end),
    isFolded,
  };
};
