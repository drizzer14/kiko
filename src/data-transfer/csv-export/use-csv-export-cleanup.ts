import { useEffect } from 'react';

import { deleteCsvExports } from './csv-file';

/**
 * Deletes the CSV files an earlier run left in the temporary folder, once at app open. It cannot
 * wait for the export screen: an app killed with the share sheet open leaves its file behind,
 * and the screen may never be opened again.
 */
export const useCsvExportCleanup = (): void => {
  useEffect(() => {
    // deleteCsvExports folds every failure and never rejects.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    deleteCsvExports();
  }, []);
};
