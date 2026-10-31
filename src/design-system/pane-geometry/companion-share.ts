import type { LayoutMode } from '@kiko/display-regions';

export const EQUAL_SHARE = 1 / 2;

// A list pane (Accounts, Settings) takes 2/5, the detail pane the other 3/5.
export const LIST_SHARE = 2 / 5;

// A deliberate exception to the 360 pt minimum of every other pane: a list row (an account card)
// still reads at 320 pt, and a pure 2/5 of a window narrower than 800 pt is narrower.
const MINIMUM_LIST_PANE_LENGTH = 320;

type SplitMode = Exclude<LayoutMode, 'single'>;

/**
 * The share the companion pane takes of a split window, from the share its tab asked for. Only
 * columns honour it, and never below the list pane floor; rows (a window split top and bottom)
 * stay equal because a list needs width, not height.
 */
export const resolveCompanionShare = (
  mode: SplitMode,
  windowLength: number,
  hairline: number,
  requestedShare: number = EQUAL_SHARE,
): number =>
  mode === 'columns'
    ? Math.max(requestedShare, MINIMUM_LIST_PANE_LENGTH / (windowLength - hairline))
    : EQUAL_SHARE;
