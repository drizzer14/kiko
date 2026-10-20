import { useWindowDimensions } from 'react-native';

import { isLargeWindow } from '../layout-mode';
import { useDisplayRegions } from '../use-display-regions';

export const useIsLargeWindow = (): boolean => {
  const { horizontalSizeClass } = useDisplayRegions();
  const { width, height } = useWindowDimensions();

  return isLargeWindow(horizontalSizeClass, width, height);
};
