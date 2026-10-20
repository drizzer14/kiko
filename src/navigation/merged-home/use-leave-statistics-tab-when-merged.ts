import {
  type NavigationContainerRef,
  NavigationContainerRefContext,
  NavigationContext,
  type NavigationProp,
  NavigationRouteContext,
  type NavigationState,
  type PartialState,
} from '@react-navigation/native';
import { useContext, useEffect, useState } from 'react';

import { PaneActions } from '../pane-stack';
import type { TabParamList } from '../types';

import { useIsMergedHome } from './use-is-merged-home';

type StackState = NavigationState | PartialState<NavigationState>;
type RouteInState = StackState['routes'][number];
type CarriedRoute = { name: string; params?: object };
type TabNavigation = NavigationProp<TabParamList>;
type Container = NavigationContainerRef<TabParamList>;

// The container's state, not the tab's own: the tab's `getState` lags a nested navigator that has
// just mounted, so it would not show the Home stack of a tab shown for the first time.
const routeWhere = (
  state: StackState | undefined,
  matches: (route: RouteInState) => boolean,
): RouteInState | undefined =>
  state?.routes
    .map((route) => (matches(route) ? route : routeWhere(route.state, matches)))
    .find((found) => found !== undefined);

// Home is the Statistics stack's companion default, and Home is the primary pane of the Home tab:
// carrying it would put a second Home in the stack.
const carriedRoutes = (stack: StackState | undefined): CarriedRoute[] =>
  (stack?.routes ?? [])
    .slice(1)
    .filter(({ name }) => name !== 'Home')
    .map(({ name, params }) => ({ name, params }));

const homeStackOf = (container: Container): StackState | undefined =>
  routeWhere(container.getRootState(), ({ name }) => name === 'HomeTab')?.state;

// Each route opens above the one before it, so the opener is read again after every dispatch.
// Returns false while the Home stack does not exist yet.
const openInHomeStack = (
  navigation: TabNavigation,
  container: Container,
  routes: readonly CarriedRoute[],
): boolean => {
  if (homeStackOf(container) === undefined) {
    return false;
  }

  for (const { name, params } of routes) {
    const home = homeStackOf(container);
    const openerKey = home?.routes.at(-1)?.key;

    if (home?.key !== undefined && openerKey !== undefined) {
      navigation.dispatch({ ...PaneActions.open(openerKey, name, params), target: home.key });
    }
  }

  return true;
};

/**
 * Moves the Statistics tab's user to the Home tab when the window merges the two, because the
 * merged window has no Statistics tab to stay on (a hidden tab that is the selected one would
 * still show). The forms and pages open above the Statistics root go along, in order and with
 * their params, into the companion pane of the Home stack, where the typed draft of a form goes on;
 * what the Home stack already holds stays. The Home stack may not have been shown yet, so the
 * routes are carried once it exists.
 *
 * Outside a tab (a stack rendered alone) there is no tab to leave, so it does nothing.
 */
export const useLeaveStatisticsTabWhenMerged = (): void => {
  const isMergedHome = useIsMergedHome();
  const navigation = useContext(NavigationContext) as TabNavigation | undefined;
  const route = useContext(NavigationRouteContext);
  // The container reports a state change of any nested navigator; the tab's own `state` event
  // does not, so it would never see the Home stack appear.
  const container = useContext(NavigationContainerRefContext) as Container | undefined;
  const [carrying, setCarrying] = useState<readonly CarriedRoute[]>([]);

  useEffect(() => {
    if (!isMergedHome || navigation?.isFocused() !== true || container === undefined) {
      return;
    }

    const statistics = routeWhere(container.getRootState(), ({ key }) => key === route?.key);

    // Read before the tab is left: the stack pops back to its root when its tab blurs.
    setCarrying(carriedRoutes(statistics?.state));
    navigation.navigate('HomeTab');
  }, [isMergedHome, navigation, container, route?.key]);

  useEffect(() => {
    if (navigation === undefined || container === undefined || carrying.length === 0) {
      return undefined;
    }

    const carry = (): void => {
      if (openInHomeStack(navigation, container, carrying)) {
        unsubscribe();
        setCarrying([]);
      }
    };
    const unsubscribe = container.addListener('state', carry);

    carry();

    return unsubscribe;
  }, [carrying, container, navigation]);
};
