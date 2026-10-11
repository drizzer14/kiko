import {
  type NavigationProp,
  type ParamListBase,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import { createContext, useCallback, useContext } from 'react';

import { PaneActions, type PaneActionType } from '../pane-router';

type DispatchPaneAction = (action: PaneActionType) => void;

// The pane navigator's own dispatch. A screen shown as a default has no navigation of its own to
// dispatch with, so the navigator hands this one to every screen it renders.
export const OpenInPaneContext = createContext<DispatchPaneAction | null>(null);

/**
 * Opens a screen in the detail pane, on top of the calling screen when that is in the detail pane
 * too, and in place of what the detail pane showed when it is the list. Outside a pane navigator
 * it is a plain navigate.
 */
export const useOpenInPane = (): ((name: string, params?: object) => void) => {
  const { key } = useRoute();
  const dispatch = useContext(OpenInPaneContext);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  return useCallback(
    (name: string, params?: object) => {
      if (dispatch === null) {
        navigation.navigate(name, params);

        return;
      }

      dispatch(PaneActions.open(key, name, params));
    },
    [dispatch, key, navigation],
  );
};
