import { useEffect, useState } from 'react';
import { useIsLargeWindow } from '@kiko/display-regions';

import { SETTLE_DELAY_MS } from '../pane-stack';

/**
 * Whether Home and Statistics are one Home tab: the window is large. The app launching on a large
 * window is merged at once, so the first frame has no Statistics tab to remove; a later change
 * waits for the burst a resize reports to end, because its first snapshots can show a size the
 * window never rests at, and the tab bar must not flicker for them.
 */
export const useIsMergedHome = (): boolean => {
  const isLargeWindow = useIsLargeWindow();
  const [isMerged, setIsMerged] = useState(isLargeWindow);

  useEffect(() => {
    if (isLargeWindow === isMerged) {
      return undefined;
    }

    const timer = setTimeout(() => setIsMerged(isLargeWindow), SETTLE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [isLargeWindow, isMerged]);

  return isMerged;
};
