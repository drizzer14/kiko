import { type FC, useMemo } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useIsFocused } from '@react-navigation/native';
import { NativeStackView } from '@react-navigation/native-stack';
import TwoPaneLayout from '@kiko/design-system/components/two-pane-layout';

import { oppositePane } from '../pane-assignment';
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
  // What the list marks is the page it opened, not whatever deeper step covers it.
  const detailSlice = oppositePane(paneConfig.rootPane) === 'primary' ? primary : companion;
  const detailFirst = detailSlice?.state.routes[0];
  const detailKey = detailFirst?.key ?? '';
  const detailName = detailFirst?.name;
  const detailParams = detailFirst?.params;
  const isDetailDefault = detailFirst?.isDefault === true;

  // The slices are new objects on every render; the context changes only when the detail pane's
  // first route or a pane's top route does.
  const detailRoute = useMemo(
    () =>
      foldMap(maybe(detailName), (name) => ({
        key: detailKey,
        name,
        params: detailParams,
        isDefault: isDetailDefault,
      })) ?? null,
    [detailKey, detailName, detailParams, isDetailDefault],
  );
  const visibility = useMemo(
    () =>
      isSplit
        ? { isTabFocused, visibleKeys: new Set([companionTopKey, primaryTopKey]), detailRoute }
        : null,
    [isSplit, isTabFocused, companionTopKey, primaryTopKey, detailRoute],
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
