import { useCallback, useContext } from 'react';

import { PaneActions } from '../pane-router';
import type { Pane } from '../pane-assignment';
import { OpenInPaneContext } from '../open-in-pane';

/**
 * Fills an empty pane with a screen the user did not tap, such as the first account of a list.
 * The pane keeps whatever the user did tap there, and a default that is already shown is
 * replaced. Outside a pane navigator there is no pane to fill, so it does nothing.
 */
export const useShowPaneDefault = (): ((pane: Pane, name: string, params?: object) => void) => {
  const dispatch = useContext(OpenInPaneContext);

  return useCallback(
    (pane: Pane, name: string, params?: object) => {
      dispatch?.(PaneActions.showDefault(pane, name, params));
    },
    [dispatch],
  );
};
