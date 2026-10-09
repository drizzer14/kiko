import maybe, { foldMap } from 'fnts/maybe';
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
 * The style that centres content in a pane and caps it at the pane max width, or nothing outside
 * a pane. A scrollable surface applies it to its content container, never to itself, so the
 * scroll view and its indicator span the whole pane.
 */
export const useContentCap = () => foldMap(maybe(usePaneContext()), () => styles.paneCap);

/**
 * What a screen changes when it is one of two panes. Outside a pane every value is what the
 * screen has always used: no cap, the SafeAreaView's own default edges, the whole clearance.
 *
 * In a pane the screen keeps a safe-area inset only on an edge the pane shares with the window,
 * and clears the tab bar only when the pane sits at the window's bottom. Its content is capped
 * at the pane max width and centred; the cap sits on the screen's own root only for a branch with
 * no scroll view, so the native header and bars, which are not inside it, still span the pane.
 */
export const usePaneScreen = () => {
  const pane = usePaneContext();
  const contentCap = useContentCap();

  if (pane === null) {
    return {
      contentCap,
      plainEdges: undefined,
      largeTitleEdges: LARGE_TITLE_EDGES,
      bottomClearanceFor: (clearance: number) => clearance,
    };
  }

  const touched = (edges: readonly Edge[]) => edges.filter((edge) => pane.edges[edge]);

  return {
    contentCap,
    plainEdges: touched(ALL_EDGES),
    largeTitleEdges: touched(LARGE_TITLE_EDGES),
    bottomClearanceFor: (clearance: number) => (pane.edges.bottom ? clearance : 0),
  };
};
