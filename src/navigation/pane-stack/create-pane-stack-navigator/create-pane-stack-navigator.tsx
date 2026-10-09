import {
  createNavigatorFactory,
  type EventArg,
  NavigationMetaContext,
  type NavigatorTypeBagBase,
  type ParamListBase,
  type StackActionHelpers,
  StackActions,
  type StackNavigationState,
  type StaticConfig,
  type TypedNavigator,
  useNavigationBuilder,
} from '@react-navigation/native';
import type {
  NativeStackNavigationEventMap,
  NativeStackNavigationOptions,
  NativeStackNavigationProp,
  NativeStackNavigatorProps,
} from '@react-navigation/native-stack';
import { useContext, useEffect, useInsertionEffect, useRef } from 'react';

import PaneStackView from '../pane-stack-view';
import { usePaneFold } from '../use-pane-fold';
import type { PaneConfig } from '../pane-assignment';
import { useSettledLayoutMode } from '../use-settled-layout-mode';
import { PaneRouter, type PaneRouterOptions, type PaneStackState } from '../pane-router';

// The router is the pane router, so the stack router override a native stack takes has no use.
type PaneStackNavigatorProps = Omit<NativeStackNavigatorProps, 'UNSTABLE_router'> & {
  paneConfig: PaneConfig;
};

function PaneStackNavigator({
  id,
  initialRouteName,
  UNSTABLE_routeNamesChangeBehavior,
  children,
  layout,
  screenListeners,
  screenOptions,
  screenLayout,
  paneConfig,
  ...rest
}: PaneStackNavigatorProps) {
  const mode = useSettledLayoutMode();
  const isSplit = mode !== 'single';
  // The router is built once, so it asks the latest settled mode when an action arrives.
  const isSplitRef = useRef(isSplit);
  const { state, describe, descriptors, navigation, NavigationContent } = useNavigationBuilder<
    PaneStackState,
    PaneRouterOptions,
    StackActionHelpers<ParamListBase>,
    NativeStackNavigationOptions,
    NativeStackNavigationEventMap
  >(PaneRouter, {
    id,
    initialRouteName,
    UNSTABLE_routeNamesChangeBehavior,
    children,
    layout,
    screenListeners,
    screenOptions,
    screenLayout,
    paneConfig,
    isSplit: () => isSplitRef.current,
  });
  const meta = useContext(NavigationMetaContext);

  // An insertion effect, so the ref is current before any child's effect in the same commit runs.
  useInsertionEffect(() => {
    isSplitRef.current = isSplit;
  }, [isSplit]);

  usePaneFold(navigation.dispatch, isSplit);

  // Re-tapping the focused tab pops the stack to its root, as a native stack does.
  useEffect(() => {
    if (meta && 'type' in meta && meta.type === 'native-tabs') {
      // Native tabs pop to the root themselves.
      return undefined;
    }

    let handle: ReturnType<typeof requestAnimationFrame> | undefined;

    // @ts-expect-error: there may not be a tab navigator in parent
    const unsubscribe = navigation.addListener?.('tabPress', (event) => {
      const isFocused = navigation.isFocused();

      cancelAnimationFrame(handle);

      // The next frame, so every listener has run and `preventDefault` is known.
      handle = requestAnimationFrame(() => {
        const currentState = navigation.getState();

        if (
          isFocused &&
          currentState.index > 0 &&
          !(event as EventArg<'tabPress', true>).defaultPrevented
        ) {
          navigation.dispatch({ ...StackActions.popToTop(), target: currentState.key });
        }
      });
    });

    return () => {
      cancelAnimationFrame(handle);
      unsubscribe?.();
    };
  }, [meta, navigation]);

  return (
    <NavigationContent>
      <PaneStackView
        {...rest}
        mode={mode}
        state={state}
        navigation={navigation}
        descriptors={descriptors}
        describe={describe}
        paneConfig={paneConfig}
      />
    </NavigationContent>
  );
}

type PaneStackTypeBag<
  ParamList extends ParamListBase = ParamListBase,
  NavigatorID extends string | undefined = string | undefined,
> = {
  ParamList: ParamList;
  NavigatorID: NavigatorID;
  State: StackNavigationState<ParamList>;
  ScreenOptions: NativeStackNavigationOptions;
  EventMap: NativeStackNavigationEventMap;
  NavigationList: {
    [RouteName in keyof ParamList]: NativeStackNavigationProp<ParamList, RouteName, NavigatorID>;
  };
  Navigator: typeof PaneStackNavigator;
};

/**
 * A native stack navigator for a tab that shows two panes on a wide window and one on a narrow
 * one. Its `paneConfig` names the root's pane and what each empty pane shows.
 */
export function createPaneStackNavigator<
  const ParamList extends ParamListBase,
  const NavigatorID extends string | undefined = string | undefined,
  const TypeBag extends NavigatorTypeBagBase = PaneStackTypeBag<ParamList, NavigatorID>,
  const Config extends StaticConfig<TypeBag> = StaticConfig<TypeBag>,
>(config?: Config): TypedNavigator<TypeBag, Config> {
  return createNavigatorFactory(PaneStackNavigator)(config);
}
