import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveTopClearance } from './top-clearance';
import { useTabBarPlacement } from './use-tab-bar-placement';

/**
 * The height of the floating top tab bar's band from the window top: the safe-area inset plus the
 * pill, or zero when the bar is not at the top. `TwoPaneLayout` starts its pane frames below it,
 * so a pane's native header sits under the bar instead of behind it. It lives in the Screen folder
 * because only that folder may read the top clearance.
 */
export const useTopBarBand = (): number => {
  const insets = useSafeAreaInsets();
  const placement = useTabBarPlacement();

  return placement === 'top' ? insets.top + resolveTopClearance(placement) : 0;
};
