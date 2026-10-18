import { useWindowDimensions } from 'react-native';

import { useDisplayRegions } from '../use-display-regions';
import { type LayoutMode, resolveLayoutMode } from '../layout-mode';

export const useLayoutMode = (): LayoutMode => {
  const { horizontalSizeClass } = useDisplayRegions();
  const { width, height } = useWindowDimensions();

  return resolveLayoutMode(horizontalSizeClass, width, height);
};
