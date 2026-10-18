import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { usePaneContext } from '@kiko/design-system/pane-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveBottomClearance } from './bottom-clearance';
import { useTabBarPlacement } from './use-tab-bar-placement';

/**
 * The clearance a view that owns the bottom edge of its screen adds above the safe-area inset, so
 * its last row clears the floating tab bar: the one a `Screen` applies itself, and the one a
 * `bleedBottom` child applies to its own content. A pane that is not at the bottom of the window
 * has no tab bar over it and gets none.
 */
export const useBottomClearance = (): number => {
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const placement = useTabBarPlacement();
  const isAwayFromWindowBottom = usePaneContext()?.edges.bottom === false;

  return isAwayFromWindowBottom
    ? 0
    : resolveBottomClearance(tabBarHeight, insets.bottom, placement);
};
