import { useEffect } from 'react';

import { backfillMccCategories } from './backfill-mcc-categories';

/**
 * Runs the one-time MCC back-fill as its own app-open step, after the first render, for the same
 * reason `useLotRecost` does: an effect of the app root runs after its screens' own effects, so
 * their first reads are queued ahead of it on op-sqlite's one worker thread. After the first run
 * it costs one settings read per open.
 */
export const useMccBackfill = (): void => {
  useEffect(() => {
    // backfillMccCategories logs every failure and never rejects.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    backfillMccCategories();
  }, []);
};
