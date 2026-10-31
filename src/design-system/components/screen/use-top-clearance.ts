import { useContext } from 'react';
import { HeaderHeightContext } from '@react-navigation/elements';
import { usePaneContext } from '@kiko/design-system/pane-context';

import { resolveTopClearance } from './top-clearance';
import { useTabBarPlacement } from './use-tab-bar-placement';

/**
 * The clearance a headerless screen adds below the safe-area inset so its content starts under a
 * floating top tab bar. A pane that does not reach the top of the window has no bar over it, and a
 * shown native header already clears the bar, so both get none.
 */
export const useTopClearance = (): number => {
  const placement = useTabBarPlacement();
  const isAwayFromWindowTop = usePaneContext()?.edges.top === false;
  const hasNativeHeader = (useContext(HeaderHeightContext) ?? 0) > 0;

  return isAwayFromWindowTop || hasNativeHeader ? 0 : resolveTopClearance(placement);
};
