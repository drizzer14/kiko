import type { HorizontalSizeClass } from '../display-regions-native';

export type LayoutMode = 'single' | 'columns' | 'rows';

// The narrowest a pane may be: below it a screen's rows and controls do not fit.
export const MINIMUM_PANE_LENGTH = 360;

// Two minimum panes plus a divider of up to 1 pt (the hairline between panes is 1 pt).
const MINIMUM_SPLIT_LENGTH = 2 * MINIMUM_PANE_LENGTH + 1;

// Only the horizontal size class and the window's shape decide the mode, never the device, its
// idiom, or its orientation, so a later device that reports a regular class gets the same rule.
// A square window is a wide one: `columns`. A regular window too short on its split axis for two
// minimum panes stays `single`.
export const resolveLayoutMode = (
  sizeClass: HorizontalSizeClass,
  width: number,
  height: number,
): LayoutMode => {
  if (sizeClass === 'compact') {
    return 'single';
  }

  const isTall = height > width;

  if ((isTall ? height : width) < MINIMUM_SPLIT_LENGTH) {
    return 'single';
  }

  return isTall ? 'rows' : 'columns';
};
