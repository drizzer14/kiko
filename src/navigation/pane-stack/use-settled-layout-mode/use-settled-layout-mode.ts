import { useEffect, useState } from 'react';
import { type LayoutMode, useLayoutMode } from '@kiko/display-regions';

// A pose change reports a burst of two or three snapshots within about 150 ms.
export const SETTLE_DELAY_MS = 150;

/**
 * The layout mode once it has held still. A change between one pane and two waits for the burst a
 * pose change reports to end, because its first snapshots can show a mode the window never rests
 * in; a rotation between the two split modes shows at once, because no screen remounts for it.
 */
export const useSettledLayoutMode = (): LayoutMode => {
  const live = useLayoutMode();
  const [settled, setSettled] = useState(live);
  const isRotation = live !== 'single' && settled !== 'single';

  useEffect(() => {
    if (live === settled) {
      return undefined;
    }

    const timer = setTimeout(() => setSettled(live), isRotation ? 0 : SETTLE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [live, settled, isRotation]);

  return isRotation ? live : settled;
};
