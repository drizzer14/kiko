import { createContext, useContext } from 'react';
import type { LayoutMode } from '@kiko/display-regions';

type SplitMode = Exclude<LayoutMode, 'single'>;

export type PaneName = 'companion' | 'primary';

// Which edges of the window a pane touches. A pane keeps a safe-area inset only on an edge it
// shares with the window, and only a pane at the bottom edge sits above the tab bar.
type PaneEdges = { top: boolean; right: boolean; bottom: boolean; left: boolean };

type PaneContextValue = { edges: PaneEdges };

// The companion is left in columns and top in rows; the primary is right and bottom. Both panes
// run the whole length of the other axis.
const PANES: Record<SplitMode, Record<PaneName, PaneContextValue>> = {
  columns: {
    companion: { edges: { top: true, right: false, bottom: true, left: true } },
    primary: { edges: { top: true, right: true, bottom: true, left: false } },
  },
  rows: {
    companion: { edges: { top: true, right: true, bottom: false, left: true } },
    primary: { edges: { top: false, right: true, bottom: true, left: true } },
  },
};

export const paneContextOf = (mode: SplitMode, pane: PaneName): PaneContextValue =>
  PANES[mode][pane];

/**
 * The pane a screen is rendered in, for the screen content to size itself by: null outside a pane
 * (one pane, where the window is the screen).
 */
export const PaneContext = createContext<PaneContextValue | null>(null);

export const usePaneContext = (): PaneContextValue | null => useContext(PaneContext);

// Apart from `PaneContext` because a width is a number a consumer compares by value, while the
// value of `PaneContext` is one shared object per pane that a consumer must not see change.
export const PaneWidthContext = createContext<number | null>(null);

/**
 * The width of the pane a screen is rendered in, in points, for what sizes itself by the pane's own
 * header (a title): null outside a pane, where the window is the screen.
 */
export const usePaneWidth = (): number | null => useContext(PaneWidthContext);
