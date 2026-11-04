import { useMemo } from 'react';
import { useIsFocused } from '@react-navigation/native';

import type { Pane } from '../pane-assignment';
import type { DetailPaneRoute } from '../pane-visibility';

type PaneVisibilityInput = {
  isSplit: boolean;
  wholeWindowPane: Pane | null;
  companionTopKey: string;
  primaryTopKey: string;
  detailRoute: DetailPaneRoute | null;
};

/**
 * What `PaneVisibilityContext` holds: null in one pane, otherwise the route on top of each pane,
 * or only the top route of the pane that takes the whole window. The hidden pane's screens stay
 * mounted but nobody sees them, so they are paused like a covered screen.
 */
export const usePaneVisibilityValue = ({
  isSplit,
  wholeWindowPane,
  companionTopKey,
  primaryTopKey,
  detailRoute,
}: PaneVisibilityInput) => {
  const isTabFocused = useIsFocused();
  const expandedTopKey = wholeWindowPane === 'companion' ? companionTopKey : primaryTopKey;

  return useMemo(
    () =>
      isSplit
        ? {
            isTabFocused,
            visibleKeys:
              wholeWindowPane === null
                ? new Set([companionTopKey, primaryTopKey])
                : new Set([expandedTopKey]),
            detailRoute,
          }
        : null,
    [
      isSplit,
      isTabFocused,
      wholeWindowPane,
      companionTopKey,
      primaryTopKey,
      expandedTopKey,
      detailRoute,
    ],
  );
};
