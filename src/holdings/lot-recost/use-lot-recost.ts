import { useEffect } from 'react';

import { recostStoredLots } from './lot-recost';

/**
 * Runs the one-time lot recost as its own app-open step, after the first
 * render: an effect of the app root runs after its screens' own effects, so
 * their first reads are queued ahead of it on op-sqlite's one worker thread.
 * After the first run it costs one settings read per open.
 */
export const useLotRecost = (): void => {
  useEffect(() => {
    // recostStoredLots logs every failure and never rejects.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    recostStoredLots();
  }, []);
};
