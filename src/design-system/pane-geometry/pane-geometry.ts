import type { FoldRegion } from '@kiko/display-regions';

export type PaneFrame = { x: number; y: number; width: number; height: number };

type PaneGeometry = {
  companion: PaneFrame;
  primary: PaneFrame;
  divider: PaneFrame;
  isFolded: boolean;
};

type Window = { width: number; height: number };
type Span = { start: number; gap: number };

const clamp = (value: number, lowest: number, highest: number) =>
  Math.min(Math.max(value, lowest), highest);

// The fold's own extent along the split axis, clamped into the window so a fold that overhangs
// never makes a pane negative.
const resolveFoldSpan = (length: number, foldStart: number, foldLength: number): Span => {
  const start = clamp(foldStart, 0, length);

  return { start, gap: clamp(foldStart + foldLength, start, length) - start };
};

const resolveSpan = (
  mode: 'columns' | 'rows',
  window: Window,
  fold: NonNullable<FoldRegion>,
): Span =>
  mode === 'columns'
    ? resolveFoldSpan(window.width, fold.x, fold.width)
    : resolveFoldSpan(window.height, fold.y, fold.height);

const placeAlongAxis = (mode: 'columns' | 'rows', window: Window, start: number, gap: number) => {
  const end = start + gap;

  if (mode === 'columns') {
    const frame = (x: number, width: number): PaneFrame => ({
      x,
      y: 0,
      width,
      height: window.height,
    });

    return {
      companion: frame(0, start),
      divider: frame(start, gap),
      primary: frame(end, window.width - end),
    };
  }

  const frame = (y: number, height: number): PaneFrame => ({
    x: 0,
    y,
    width: window.width,
    height,
  });

  return {
    companion: frame(0, start),
    divider: frame(start, gap),
    primary: frame(end, window.height - end),
  };
};

// Pure pane geometry. Flat: equal halves around a hairline divider. Folded: each pane ends at the
// fold edge and the divider collapses to nothing, so the panes are equal only when the fold is
// centred.
export const resolvePaneGeometry = (
  mode: 'columns' | 'rows',
  window: Window,
  fold: FoldRegion,
  hairline: number,
): PaneGeometry => {
  if (fold === null) {
    const length = mode === 'columns' ? window.width : window.height;

    return {
      ...placeAlongAxis(mode, window, (length - hairline) / 2, hairline),
      isFolded: false,
    };
  }

  const { start, gap } = resolveSpan(mode, window, fold);
  const frames = placeAlongAxis(mode, window, start, gap);

  return {
    ...frames,
    divider: placeAlongAxis(mode, window, start, 0).divider,
    isFolded: true,
  };
};
