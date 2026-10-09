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
  // Whether the fold runs along the axis the panes do not split, which is the only fold that can
  // sit between two panes of this mode. Orientation alone decides it: the fold and the window
  // arrive separately and a size comparison would flip on a fraction of a point.
  foldSpansCross: (fold: Fold) => boolean;
  frame: (window: Window, start: number, length: number) => PaneFrame;
};

const AXES: Record<SplitMode, Axis> = {
  columns: {
    windowLength: (window) => window.width,
    foldStart: (fold) => fold.x,
    foldLength: (fold) => fold.width,
    foldSpansCross: (fold) => fold.height > fold.width,
    frame: (window, start, length) => ({ x: start, y: 0, width: length, height: window.height }),
  },
  rows: {
    windowLength: (window) => window.height,
    foldStart: (fold) => fold.y,
    foldLength: (fold) => fold.height,
    foldSpansCross: (fold) => fold.width > fold.height,
    frame: (window, start, length) => ({ x: 0, y: start, width: window.width, height: length }),
  },
};

const clamp = (value: number, lowest: number, highest: number) =>
  Math.min(Math.max(value, lowest), highest);

// Pure pane geometry. Flat: equal halves around a hairline divider. Folded: each pane ends at the
// fold edge, so the panes are equal only when the fold is centred; the divider is then the fold's
// own gap, which the caller does not draw. A fold that does not span the mode's cross axis is a
// transient from a rotation (the window and the fold arrive separately), so it counts as flat.
export const resolvePaneGeometry = (
  mode: SplitMode,
  window: Window,
  fold: FoldRegion,
  hairline: number,
): PaneGeometry => {
  const axis = AXES[mode];
  const length = axis.windowLength(window);
  const isFolded = fold !== null && axis.foldSpansCross(fold);
  // The fold's extent is clamped into the window so a fold that overhangs never makes a pane
  // negative.
  const start = isFolded ? clamp(axis.foldStart(fold), 0, length) : (length - hairline) / 2;
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
