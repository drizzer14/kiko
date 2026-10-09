import { createContext, useContext } from 'react';
import type { LayoutMode } from '@kiko/display-regions';

type SplitMode = Exclude<LayoutMode, 'single'>;

export type PaneName = 'companion' | 'primary';

// Which edges of the window a pane touches. A pane keeps a safe-area inset only on an edge it
// shares with the window, and only a pane at the bottom edge sits above the tab bar.
export type PaneEdges = { top: boolean; right: boolean; bottom: boolean; left: boolean };

export type PaneContextValue = { pane: PaneName; mode: SplitMode; edges: PaneEdges };

const edgesOf = (top: boolean, right: boolean, bottom: boolean, left: boolean): PaneEdges => ({
  top,
  right,
  bottom,
  left,
});

// The companion is left in columns and top in rows; the primary is right and bottom. Both panes
// run the whole length of the other axis.
const PANES: Record<SplitMode, Record<PaneName, PaneContextValue>> = {
  columns: {
    companion: { mode: 'columns', pane: 'companion', edges: edgesOf(true, false, true, true) },
    primary: { mode: 'columns', pane: 'primary', edges: edgesOf(true, true, true, false) },
  },
  rows: {
    companion: { mode: 'rows', pane: 'companion', edges: edgesOf(true, true, false, true) },
    primary: { mode: 'rows', pane: 'primary', edges: edgesOf(false, true, true, true) },
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
