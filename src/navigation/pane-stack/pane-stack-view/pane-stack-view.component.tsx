import { type FC, useMemo } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
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
  const primaryTop = primary?.state.routes.at(-1);
  const primaryTopKey = primaryTop?.key ?? '';
  const primaryName = primaryTop?.name;
  const primaryParams = primaryTop?.params;
  const isPrimaryDefault = primaryTop?.isDefault === true;

  // The slices are new objects on every render; the context changes only when a top route does.
  const primaryRoute = useMemo(
    () =>
      foldMap(maybe(primaryName), (name) => ({
        key: primaryTopKey,
        name,
        params: primaryParams,
        isDefault: isPrimaryDefault,
      })) ?? null,
    [primaryTopKey, primaryName, primaryParams, isPrimaryDefault],
  );
  const visibility = useMemo(
    () =>
      isSplit
        ? { isTabFocused, visibleKeys: new Set([companionTopKey, primaryTopKey]), primaryRoute }
        : null,
    [isSplit, isTabFocused, companionTopKey, primaryTopKey, primaryRoute],
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
