import maybe, { foldMap } from 'fnts/maybe';

import {
  defaultRouteKey,
  type Pane,
  type PaneConfig,
  paneDefault,
  routesOfPane,
} from '../pane-assignment';
import type { PaneStackRoute, PaneStackState } from '../pane-router';

import type { NativeStackViewProps } from './pane-stack-view.props';

type PaneSlice = {
  state: PaneStackState;
  descriptors: NativeStackViewProps['descriptors'];
};

// The state a native stack shows: only the routes it is given, the last one focused.
const stateOf = (state: PaneStackState, routes: PaneStackRoute[]): PaneStackState => ({
  ...state,
  routes,
  index: routes.length - 1,
  preloadedRoutes: [],
});

/**
 * The stack of one pane: its routes in order, or, when it has none, its default as a synthetic
 * route the navigator describes without having it in its state. A pane with neither has no stack.
 */
export const paneSlice = (
  state: PaneStackState,
  config: PaneConfig,
  pane: Pane,
  descriptors: NativeStackViewProps['descriptors'],
  describe: NativeStackViewProps['describe'],
): PaneSlice | null => {
  const routes = routesOfPane(state.routes, state.panes, config, pane);

  if (routes.length > 0) {
    return { state: stateOf(state, routes), descriptors };
  }

  return (
    foldMap(maybe(paneDefault(config, pane)), (shown) => {
      const standIn: PaneStackRoute = {
        key: defaultRouteKey(pane),
        name: shown.name,
        params: shown.params,
        isDefault: true,
      };

      return {
        state: stateOf(state, [standIn]),
        descriptors: { ...descriptors, [standIn.key]: describe(standIn, true) },
      };
    }) ?? null
  );
};

/**
 * The state one pane shows: a default route is a choice for a second pane, so it stays out of
 * the only one.
 */
export const withoutDefaultRoutes = (state: PaneStackState): PaneStackState => {
  const routes = state.routes.filter((route) => route.isDefault !== true);

  return routes.length === state.routes.length ? state : stateOf(state, routes);
};
