import { useEffect, useRef } from 'react';

import { PaneActions, type PaneActionType } from '../pane-router';

/**
 * Folds the navigation state when the window goes from two panes to one, and unfolds it when it
 * goes back. The state a mount starts with already matches its mode, so a mount dispatches
 * nothing.
 */
export const usePaneFold = (dispatch: (action: PaneActionType) => void, isSplit: boolean) => {
  const wasSplit = useRef(isSplit);

  useEffect(() => {
    if (wasSplit.current === isSplit) {
      return;
    }

    wasSplit.current = isSplit;
    dispatch(isSplit ? PaneActions.unfold() : PaneActions.fold());
  }, [dispatch, isSplit]);
};
