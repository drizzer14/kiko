import { useWindowDimensions } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { useTabBarEdge, useVerticalBarEdge } from '@kiko/display-regions';

import { type TabBarPlacement, tabBarPlacementOf } from './tab-bar-placement';

/** Where the tab bar sits in this window: the one answer `Screen` and its children clear. */
export const useTabBarPlacement = (): TabBarPlacement => {
  const tabBarEdge = useTabBarEdge();
  const verticalBarEdge = useVerticalBarEdge();
  const tabBarHeight = useBottomTabBarHeight();
  const windowHeight = useWindowDimensions().height;

  return tabBarPlacementOf(tabBarEdge, verticalBarEdge, tabBarHeight, windowHeight);
};
