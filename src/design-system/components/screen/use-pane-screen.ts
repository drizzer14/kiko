import type { Edge } from 'react-native-safe-area-context';
import { usePaneContext } from '@kiko/design-system/pane-context';

import { styles } from './screen.styles';

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

// A large-title navigator header owns the top inset itself, so any branch whose content sits under
// one drops the SafeAreaView's top edge: keeping it would double-offset content beneath the
// header. It is the always-scrolling `scroll` branch and the plain branch's `bleedTop` opt-in (a
// large-title screen whose child is itself the scrollable surface, e.g. HoldingDetail's ledger
// FlatList).
const LARGE_TITLE_EDGES: readonly Edge[] = ['left', 'right', 'bottom'];

/**
 * What a screen changes when it is one of two panes. Outside a pane every value is what the
 * screen has always used: no cap, the SafeAreaView's own default edges, the whole clearance.
 *
 * In a pane the screen content is capped at the pane max width and centred, keeps a safe-area
 * inset only on an edge the pane shares with the window, and clears the tab bar only when the
 * pane sits at the window's bottom. The cap is on the screen's own root, so the native header
 * and bars, which are not inside it, still span the whole pane.
 */
export const usePaneScreen = () => {
  const pane = usePaneContext();

  if (pane === null) {
    return {
      rootStyle: styles.safeArea,
      plainEdges: undefined,
      largeTitleEdges: LARGE_TITLE_EDGES,
      bottomClearanceFor: (clearance: number) => clearance,
    };
  }

  const touched = (edges: readonly Edge[]) => edges.filter((edge) => pane.edges[edge]);

  return {
    rootStyle: [styles.safeArea, styles.paneCap],
    plainEdges: touched(ALL_EDGES),
    largeTitleEdges: touched(LARGE_TITLE_EDGES),
    bottomClearanceFor: (clearance: number) => (pane.edges.bottom ? clearance : 0),
  };
};
