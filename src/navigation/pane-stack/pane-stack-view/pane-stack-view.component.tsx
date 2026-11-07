import maybe, { foldMap } from 'fnts/maybe';
import {
  useContentMarginFor,
  useIsTabBarNotAtBottom,
  useTabBarPlacement,
} from '@kiko/design-system/components/screen';
import { type FC, useEffect, useMemo, useState } from 'react';
import { FixedContentMarginContext } from 'react-native-screens';
import TwoPaneLayout from '@kiko/design-system/components/two-pane-layout';
import { NativeStackView, type NativeStackNavigationOptions } from '@react-navigation/native-stack';

import { oppositePane } from '../pane-assignment';
import { OpenInPaneContext } from '../open-in-pane';
import { PaneVisibilityContext } from '../pane-visibility';

import type { PaneStackViewProps } from './pane-stack-view.props';
import { usePaneVisibilityValue } from './use-pane-visibility-value';
import { type LayerSlice, layerSlice, paneSlice, withoutDefaultRoutes } from './pane-slice';
import { keepStandInOptions, type StandInOptions, withStandInOptions } from './stand-in-options';

type LayerStackProps = Pick<PaneStackViewProps, 'navigation' | 'describe'> & {
  slice: LayerSlice;
};

// The pages of the layer over both panes need no fixed content margin, so its stack is told 0 in
// every pose, which keeps the react-native-screens patch's margin write inert on it. With the
// margin the side-bar pose gave it, the device showed the layer's bar go see-through during a
// swipe back on the unfolded Duo in landscape; the panes keep the margin they are told.
const LayerStack: FC<LayerStackProps> = ({ slice, navigation, describe }) => {
  return (
    <FixedContentMarginContext.Provider value={0}>
      <NativeStackView
        state={slice.state}
        navigation={navigation}
        descriptors={slice.descriptors}
        describe={describe}
      />
    </FixedContentMarginContext.Provider>
  );
};

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
  const isTabBarNotAtBottom = useIsTabBarNotAtBottom();
  const tabBarPlacement = useTabBarPlacement();
  const isSplit = mode !== 'single';
  const [isSplitShown, setIsSplitShown] = useState(isSplit);
  // A switch between one pane and two unmounts a route's screen in one layout and mounts it in the
  // other. React Navigation's SceneView clears a route's options, keyed by the route key, when it
  // unmounts, and that cleanup runs after the new screen's layout effect has set its options: the
  // screen's title and header items are lost. Mounting the new layout one commit after the old one
  // unmounted (this one renders neither, for about a frame) lets the old cleanup run first.
  const isSwitching = isSplitShown !== isSplit;
  // The panes' margins never depend on the layer over them, or a stack would be told a new one as
  // a page opens. The layer's screens are the window's, so it is told the single stack's.
  const hasFixedContentMargin = isSplit ? isTabBarNotAtBottom : tabBarPlacement === 'side';
  const contentMargin = useContentMarginFor(isSplit);
  const { dispatch } = navigation;
  // A screen shown as a default has no route in the state, so React Navigation keeps nothing for
  // its `setOptions`; they are kept here and lie over the static options it is described with.
  const [standInOptions, setStandInOptions] = useState<StandInOptions>({});
  const standIns = useMemo(
    () => ({
      options: standInOptions,
      setOptions: (key: string, options: NativeStackNavigationOptions) =>
        setStandInOptions((all) => withStandInOptions(all, key, options)),
    }),
    [standInOptions],
  );
  const companion = isSplit
    ? paneSlice(state, paneConfig, 'companion', descriptors, describe, dispatch, standIns)
    : null;
  const primary = isSplit
    ? paneSlice(state, paneConfig, 'primary', descriptors, describe, dispatch, standIns)
    : null;
  const layer = layerSlice(state, paneConfig, descriptors, describe);
  const companionStandInKey = companion?.standInKey ?? '';
  const primaryStandInKey = primary?.standInKey ?? '';
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
  const visibility = usePaneVisibilityValue({
    isSplit,
    layer,
    companionTopKey,
    primaryTopKey,
    detailRoute,
  });

  useEffect(() => {
    setIsSplitShown(isSplit);
  }, [isSplit]);

  // A default shown again after a page took its pane, or after a fold, is a new screen: it sets
  // its options afresh, from its own.
  useEffect(() => {
    setStandInOptions((all) => keepStandInOptions(all, [companionStandInKey, primaryStandInKey]));
  }, [companionStandInKey, primaryStandInKey]);

  return (
    <OpenInPaneContext.Provider value={dispatch}>
      <PaneVisibilityContext.Provider value={visibility}>
        {/* UIKit insets a native large title by the stack's distance to the window's edge, so the
            title and the content line up only if the stack is told the content's margin (16 pt,
            20 pt for a split under a side bar). A bottom bar keeps UIKit's margin. Split panes are
            told under a top or a side bar, whatever the window's size; the single stack only under
            a side bar (the Duo outer pose, told 16), where UIKit's title would start off the
            content's margin. A single stack under a top bar keeps UIKit's margin. */}
        <FixedContentMarginContext.Provider value={hasFixedContentMargin ? contentMargin : 0}>
          {!isSwitching && isSplit && (
            <TwoPaneLayout
              mode={mode}
              isLayerShown={Boolean(layer?.topKey)}
              companionShare={paneConfig.companionShare}
              layer={
                layer ? (
                  <LayerStack slice={layer} navigation={navigation} describe={describe} />
                ) : undefined
              }
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
          )}

          {!isSwitching && !isSplit && (
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
