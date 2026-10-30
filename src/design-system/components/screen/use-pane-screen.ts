import maybe, { foldMap } from 'fnts/maybe';
import { useUnistyles } from 'react-native-unistyles';
import { useDisplayRegions } from '@kiko/display-regions';
import type { Edge } from 'react-native-safe-area-context';
import { usePaneContext, usePaneWidth } from '@kiko/design-system/pane-context';

import { styles } from './screen.styles';
import { useIsTabBarAtTop } from './use-is-tab-bar-at-top';
import { useIsBottomInsetPadded } from './use-bottom-clearance';

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

// A large-title navigator header owns the top inset itself, so any branch whose content sits under
// one drops the SafeAreaView's top edge: keeping it would double-offset content beneath the
// header. It is the always-scrolling `scroll` branch and the plain branch's `bleedTop` opt-in (a
// large-title screen whose child is itself the scrollable surface, e.g. HoldingDetail's ledger
// FlatList).
const LARGE_TITLE_EDGES: readonly Edge[] = ['left', 'right', 'bottom'];

/**
 * The style that centres content and caps it at the pane max width, in a pane or anywhere on a
 * regular window (where one screen would otherwise stretch across the whole window), and nothing
 * on a compact window. A pane under a top tab bar is the exception: its content spans the pane,
 * where the native large title starts (`useIsTabBarAtTop`). It reads the size class, never the
 * live layout mode: the panes follow the settled mode, which lags the live one, so a screen that
 * has not yet moved into a pane keeps its cap through a resize into a split. A scrollable surface
 * applies it to its content container, never to itself, so the scroll view and its indicator span
 * the whole pane; a screen with no scroll view takes it on its root, so the native header and
 * bars, which are not inside it, still span the pane.
 */
export const useContentCap = () => {
  const pane = usePaneContext();
  const { horizontalSizeClass } = useDisplayRegions();
  const isTabBarAtTop = useIsTabBarAtTop();

  if (pane !== null && isTabBarAtTop) {
    return undefined;
  }

  if (pane !== null || horizontalSizeClass === 'regular') {
    return styles.paneCap;
  }

  return undefined;
};

/**
 * The width a pane's content can use, for what sizes itself by the room it has (a shared chart
 * row): the pane's width, limited by the cap `useContentCap` puts on it. Null outside a pane.
 */
export const usePaneContentWidth = (): number | null => {
  const paneWidth = usePaneWidth();
  const { theme } = useUnistyles();
  const contentCap = useContentCap();

  if (paneWidth === null || contentCap === undefined) {
    return paneWidth;
  }

  return Math.min(paneWidth, theme.layout.paneMaxWidth);
};

const STOP_INDICATOR_INSETS = { automaticallyAdjustsScrollIndicatorInsets: false } as const;

/**
 * The scroll view props that keep a scroll indicator at the edge of its own pane. UIKit insets the
 * indicator by the window's right safe-area inset (the vertical tab bar), which put it inside the
 * content of a pane that does not reach that edge. A pane at the window's right edge, and a screen
 * outside a pane, keep UIKit's own inset. Spread it into every scroll view a screen renders.
 */
export const useScrollIndicatorProps = () =>
  foldMap(maybe(usePaneContext()), (pane) => (pane.edges.right ? {} : STOP_INDICATOR_INSETS));

/**
 * The edges a screen's SafeAreaView reserves when it is one of two panes. Outside a pane they are
 * what the screen has always used: the SafeAreaView's own default edges. In a pane the screen
 * keeps a safe-area inset only on an edge the pane shares with the window. Beside a side bar the
 * bottom edge is dropped everywhere (`useIsBottomInsetPadded`): the content runs to the window's
 * bottom and pads the inset itself.
 */
export const usePaneScreen = () => {
  const pane = usePaneContext();
  const isBottomInsetPadded = useIsBottomInsetPadded();

  const withoutPaddedBottom = (edges: readonly Edge[]) =>
    isBottomInsetPadded ? edges.filter((edge) => edge !== 'bottom') : edges;

  if (pane === null) {
    return {
      plainEdges: isBottomInsetPadded ? withoutPaddedBottom(ALL_EDGES) : undefined,
      largeTitleEdges: withoutPaddedBottom(LARGE_TITLE_EDGES),
    };
  }

  const touched = (edges: readonly Edge[]) => edges.filter((edge) => pane.edges[edge]);

  return {
    plainEdges: withoutPaddedBottom(touched(ALL_EDGES)),
    largeTitleEdges: withoutPaddedBottom(touched(LARGE_TITLE_EDGES)),
  };
};
