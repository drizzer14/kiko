import { match } from 'ts-pattern';
import type { LayoutMode } from '@kiko/display-regions';
import type { PaneName } from '@kiko/design-system/pane-context';

export const EQUAL_SHARE = 1 / 2;
export const WIDE_SHARE = 2 / 3;
// The narrowest window whose smaller pane at the wide share still holds the minimum pane length:
// (1100 - hairline) / 3 is about 366 pt, so the sweep above it never goes under 360 pt.
export const WIDE_SPLIT_MIN_WIDTH = 1100;

type Window = { width: number; height: number };

const wideShareOf = (wideSlot: PaneName | undefined) =>
  match(wideSlot)
    .with('companion', () => WIDE_SHARE)
    .with('primary', () => 1 - WIDE_SHARE)
    .with(undefined, () => EQUAL_SHARE)
    .exhaustive();

// The fraction of the window length (less the hairline) the companion gets on a flat window. Only
// columns at a wide window give the tab's wide slot two thirds; rows and a narrower window stay
// equal halves.
export const resolveCompanionShare = (
  mode: Exclude<LayoutMode, 'single'>,
  window: Window,
  wideSlot: PaneName | undefined,
): number =>
  match(mode)
    .with('rows', () => EQUAL_SHARE)
    .with('columns', () =>
      window.width >= WIDE_SPLIT_MIN_WIDTH ? wideShareOf(wideSlot) : EQUAL_SHARE,
    )
    .exhaustive();
