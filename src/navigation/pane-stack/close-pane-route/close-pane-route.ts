import { useCallback, useContext } from 'react';

import { PaneActions } from '../pane-router';
import { OpenInPaneContext } from '../open-in-pane';

/**
 * Closes one route of the pane navigator by its key, for a list that sees the entity behind a page
 * in the other pane go away. Outside a pane navigator there is no pane to close a route of, so it
 * does nothing.
 */
export const useClosePaneRoute = (): ((routeKey: string) => void) => {
  const dispatch = useContext(OpenInPaneContext);

  return useCallback(
    (routeKey: string) => {
      dispatch?.(PaneActions.close(routeKey));
    },
    [dispatch],
  );
};
