import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { usePaneContext } from '@kiko/design-system/pane-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TabBarPlacement } from './tab-bar-placement';
import { useTabBarPlacement } from './use-tab-bar-placement';
import { resolveAutomaticScrollClearance, resolveBottomClearance } from './bottom-clearance';

const useClearanceOf = (
  resolve: (tabBarHeight: number, insetBottom: number, placement: TabBarPlacement) => number,
): number => {
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const placement = useTabBarPlacement();
  const isAwayFromWindowBottom = usePaneContext()?.edges.bottom === false;

  return isAwayFromWindowBottom ? 0 : resolve(tabBarHeight, insets.bottom, placement);
};

/**
 * The clearance a view that owns the bottom edge of its screen adds above the safe-area inset, so
 * its last row clears the floating tab bar: the one a `Screen` applies itself, and the one a
 * `bleedBottom` child applies to its own content. A pane that is not at the bottom of the window
 * has no tab bar over it and gets none. Beside a side bar it is the inset itself, because the
 * screen's SafeAreaView does not reserve it there (`useIsBottomInsetPadded`).
 */
export const useBottomClearance = (): number => useClearanceOf(resolveBottomClearance);

/**
 * `useBottomClearance` for a scroll view with `contentInsetAdjustmentBehavior="automatic"`, which
 * may get the inset beside a side bar from UIKit already (`resolveAutomaticScrollClearance`).
 */
export const useAutomaticScrollClearance = (): number =>
  useClearanceOf(resolveAutomaticScrollClearance);

/**
 * Whether the content gives the bottom safe-area inset back as its own padding: beside a side
 * bar, in a pane that touches the window's bottom. The screen's SafeAreaView then drops its
 * bottom edge so the scroll views and lists run to the window's bottom.
 */
export const useIsBottomInsetPadded = (): boolean => {
  const placement = useTabBarPlacement();
  const isAwayFromWindowBottom = usePaneContext()?.edges.bottom === false;

  return placement === 'side' && !isAwayFromWindowBottom;
};
