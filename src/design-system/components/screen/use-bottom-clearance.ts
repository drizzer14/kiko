import { useWindowDimensions } from 'react-native';
import { useVerticalBarEdge } from '@kiko/display-regions';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePaneScreen } from './use-pane-screen';
import { resolveBottomClearance } from './bottom-clearance';

/**
 * The clearance a view that owns the bottom edge of its screen adds above the safe-area inset, so
 * its last row clears the floating tab bar: the one a `Screen` applies itself, and the one a
 * `bleedBottom` child applies to its own content. A pane that is not at the bottom of the window
 * has no tab bar over it and gets none.
 */
export const useBottomClearance = (): number => {
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const windowHeight = useWindowDimensions().height;
  const verticalBarEdge = useVerticalBarEdge();
  const { bottomClearanceFor } = usePaneScreen();

  return bottomClearanceFor(
    resolveBottomClearance(tabBarHeight, insets.bottom, verticalBarEdge, windowHeight),
  );
};
