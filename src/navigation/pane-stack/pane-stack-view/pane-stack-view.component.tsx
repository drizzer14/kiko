import { type FC, useMemo } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import {
  useContentMargin,
  useIsTabBarNotAtBottom,
  useTabBarPlacement,
} from '@kiko/design-system/components/screen';
import { useIsFocused } from '@react-navigation/native';
import { FixedContentMarginContext } from 'react-native-screens';
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
  const isTabBarNotAtBottom = useIsTabBarNotAtBottom();
  const tabBarPlacement = useTabBarPlacement();
  const isSplit = mode !== 'single';
  const hasFixedContentMargin = isSplit ? isTabBarNotAtBottom : tabBarPlacement === 'side';
  const contentMargin = useContentMargin();
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
        {/* UIKit insets a native large title by the stack's distance to the window's edge, so the
            title and the content line up only if the stack is told the content's margin (16 pt,
            20 pt under a side bar). A bottom bar keeps UIKit's margin. Split panes are told under a
            top or a side bar, whatever the window's size; the single stack only under a side bar
            (the Duo outer pose), where UIKit's title would start off the content's margin. A
            single stack under a top bar keeps UIKit's margin. */}
        <FixedContentMarginContext.Provider value={hasFixedContentMargin ? contentMargin : 0}>
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
        </FixedContentMarginContext.Provider>
      </PaneVisibilityContext.Provider>
    </OpenInPaneContext.Provider>
  );
};

export default PaneStackView;
