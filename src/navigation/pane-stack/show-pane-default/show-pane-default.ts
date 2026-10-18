import { useCallback, useContext } from 'react';

import { PaneActions } from '../pane-router';
import { OpenInPaneContext } from '../open-in-pane';

/**
 * Fills the detail pane, while it has no page of its own, with a screen the user did not tap, such
 * as the first account of a list. The pane keeps whatever the user did tap there, and a default
 * that is already shown is replaced. A placeholder default (an empty state, say) stays a default
 * when the user opens something from it, where any other default becomes a page of the pane.
 * Outside a pane navigator, and while the navigator shows one pane, there is no pane to fill, so
 * it does nothing.
 */
export const useShowPaneDefault = (): ((
  name: string,
  params?: object,
  isPlaceholder?: boolean,
) => void) => {
  const dispatch = useContext(OpenInPaneContext);

  return useCallback(
    (name: string, params?: object, isPlaceholder?: boolean) => {
      dispatch?.(PaneActions.showDefault(name, params, isPlaceholder));
    },
    [dispatch],
  );
};
