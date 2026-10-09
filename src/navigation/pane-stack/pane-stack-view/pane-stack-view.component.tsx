import { type FC, useMemo } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { NativeStackView } from '@react-navigation/native-stack';
import TwoPaneLayout from '@kiko/design-system/components/two-pane-layout';

import { OpenInPaneContext } from '../open-in-pane';
import { PaneVisibilityContext } from '../pane-visibility';

import { paneSlice, withoutDefaultRoutes } from './pane-slice';
import type { PaneStackViewProps } from './pane-stack-view.props';

/**
 * The view of a pane navigator: the native stack with the whole state on a narrow window, and on
 * a wide one a native stack for each pane, each given only that pane's routes.
 */
const PaneStackView: FC<PaneStackViewProps> = ({
  state,
  navigation,
  descriptors,
  describe,
  paneConfig,
  mode,
}) => {
  const isTabFocused = useIsFocused();
  const isSplit = mode !== 'single';
  const { dispatch } = navigation;
  const companion = isSplit
    ? paneSlice(state, paneConfig, 'companion', descriptors, describe, dispatch)
    : null;
  const primary = isSplit
    ? paneSlice(state, paneConfig, 'primary', descriptors, describe, dispatch)
    : null;
  const companionTopKey = companion?.state.routes.at(-1)?.key ?? '';
  const primaryTopKey = primary?.state.routes.at(-1)?.key ?? '';

  // The slices are new objects on every render; the context changes only when a top route does.
  const visibility = useMemo(
    () =>
      isSplit ? { isTabFocused, visibleKeys: new Set([companionTopKey, primaryTopKey]) } : null,
    [isSplit, isTabFocused, companionTopKey, primaryTopKey],
  );

  return (
    <OpenInPaneContext.Provider value={dispatch}>
      <PaneVisibilityContext.Provider value={visibility}>
        {isSplit ? (
          <TwoPaneLayout
            mode={mode}
            companion={
              companion && (
                <NativeStackView
                  state={companion.state}
                  navigation={navigation}
                  descriptors={companion.descriptors}
                  describe={describe}
                />
              )
            }
            primary={
              primary && (
                <NativeStackView
                  state={primary.state}
                  navigation={navigation}
                  descriptors={primary.descriptors}
                  describe={describe}
                />
              )
            }
          />
        ) : (
          <NativeStackView
            state={withoutDefaultRoutes(state)}
            navigation={navigation}
            descriptors={descriptors}
            describe={describe}
          />
        )}
      </PaneVisibilityContext.Provider>
    </OpenInPaneContext.Provider>
  );
};

export default PaneStackView;
