import { useEffect } from 'react';

import { useDisplayRegions } from '../use-display-regions';
import { type TabBarEdge, displayRegionsNative } from '../display-regions-native';

export const useTabBarEdge = (): TabBarEdge => {
  // Read before the effect: the subscription's effect runs first, so the refresh it asks for finds
  // a listener.
  const { tabBarEdge } = useDisplayRegions();

  // The native read before the tab view mounts says `none`, and nothing native fires when the
  // bar appears, so each mount asks for one more read.
  useEffect(() => {
    displayRegionsNative.requestRefresh();
  }, []);

  return tabBarEdge;
};
