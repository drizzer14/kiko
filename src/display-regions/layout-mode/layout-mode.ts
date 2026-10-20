import { match } from 'ts-pattern';

import type { HorizontalSizeClass } from '../display-regions-native';

export type LayoutMode = 'single' | 'columns' | 'rows';

// The narrowest a pane may be: below it a screen's rows and controls do not fit.
export const MINIMUM_PANE_LENGTH = 360;

// Two minimum panes plus a divider of up to 1 pt (the hairline between panes is 1 pt).
const MINIMUM_SPLIT_LENGTH = 2 * MINIMUM_PANE_LENGTH + 1;

// A window big enough for two minimum panes on its shorter side in a regular class: every
// full-screen iPad is large, a Duo inner window never is (its shorter side is 669).
export const isLargeWindow = (
  sizeClass: HorizontalSizeClass,
  width: number,
  height: number,
): boolean => sizeClass === 'regular' && Math.min(width, height) >= MINIMUM_SPLIT_LENGTH;

// Only the horizontal size class and the window's size decide the mode, never the device or its
// idiom, so a later device that reports a regular class gets the same rule. A window wide enough
// for two minimum panes side by side is `columns`, whatever its orientation (a portrait iPad
// included). A narrower, taller window stacks its panes (`rows`) when it is tall enough for two
// minimum panes; any other regular window stays `single`.
export const resolveLayoutMode = (
  sizeClass: HorizontalSizeClass,
  width: number,
  height: number,
): LayoutMode =>
  match(sizeClass)
    .with('compact', (): LayoutMode => 'single')
    .with('regular', (): LayoutMode => {
      if (width >= MINIMUM_SPLIT_LENGTH) {
        return 'columns';
      }

      return height > width && height >= MINIMUM_SPLIT_LENGTH ? 'rows' : 'single';
    })
    .exhaustive();
