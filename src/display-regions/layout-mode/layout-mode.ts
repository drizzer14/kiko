import { match } from 'ts-pattern';

import type { HorizontalSizeClass } from '../display-regions-native';

export type LayoutMode = 'single' | 'columns' | 'rows';

// The narrowest a pane may be: below it a screen's rows and controls do not fit.
export const MINIMUM_PANE_LENGTH = 360;

// Two minimum panes plus a divider of up to 1 pt (the hairline between panes is 1 pt).
const MINIMUM_SPLIT_LENGTH = 2 * MINIMUM_PANE_LENGTH + 1;

// A window big enough for two minimum panes on its shorter side in a regular class: a full-screen
// iPad, never a Duo inner window or a Split View window.
export const isLargeWindow = (
  sizeClass: HorizontalSizeClass,
  width: number,
  height: number,
): boolean => sizeClass === 'regular' && Math.min(width, height) >= MINIMUM_SPLIT_LENGTH;

// Only the horizontal size class and the window's shape decide the mode, never the device, its
// idiom, or its orientation, so a later device that reports a regular class gets the same rule.
// A square window is a wide one: `columns`. A regular window too short on its split axis for two
// minimum panes stays `single`.
export const resolveLayoutMode = (
  sizeClass: HorizontalSizeClass,
  width: number,
  height: number,
): LayoutMode =>
  match(sizeClass)
    .with('compact', (): LayoutMode => 'single')
    .with('regular', (): LayoutMode => {
      const isTall = height > width;

      if ((isTall ? height : width) < MINIMUM_SPLIT_LENGTH) {
        return 'single';
      }

      return isTall ? 'rows' : 'columns';
    })
    .exhaustive();
