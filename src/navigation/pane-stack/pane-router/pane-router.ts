import {
  type CommonNavigationAction,
  type ParamListBase,
  type PartialState,
  type Router,
  type RouterConfigOptions,
  StackActions,
  type StackActionType,
  type StackNavigationState,
  StackRouter,
  type StackRouterOptions,
} from '@react-navigation/native';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';

import {
  foldAssignment,
  openFrom,
  type Pane,
  type PaneConfig,
  type PaneMap,
  retainPanes,
  routesOfPane,
  unfoldAssignment,
} from '../pane-assignment';

type PaneRoute = { name: string; params?: object };

export type PaneActionType =
  | {
      type: 'PANE_OPEN';
      payload: { openerKey: string; route: PaneRoute };
      source?: string;
      target?: string;
    }
  | { type: 'PANE_FOLD'; source?: string; target?: string }
  | { type: 'PANE_UNFOLD'; source?: string; target?: string }
  | {
      type: 'PANE_SHOW_DEFAULT';
      payload: { pane: Pane; route: PaneRoute };
      source?: string;
      target?: string;
    };

export const PaneActions = {
  open: (openerKey: string, name: string, params?: object) =>
    ({ type: 'PANE_OPEN', payload: { openerKey, route: { name, params } } }) as const,
  fold: () => ({ type: 'PANE_FOLD' }) as const,
  unfold: () => ({ type: 'PANE_UNFOLD' }) as const,
  showDefault: (pane: Pane, name: string, params?: object) =>
    ({ type: 'PANE_SHOW_DEFAULT', payload: { pane, route: { name, params } } }) as const,
} satisfies Record<string, (...args: never[]) => PaneActionType>;

type StackState = StackNavigationState<ParamListBase>;

export type PaneStackRoute = StackState['routes'][number] & { isDefault?: boolean };

export type PaneStackState = Omit<StackState, 'routes'> & {
  routes: PaneStackRoute[];
  // The pane of each route key that has one stored. See `PaneMap`.
  panes: PaneMap;
};

export type PaneRouterOptions = StackRouterOptions & { paneConfig: PaneConfig };

export type PaneRouterAction = PaneActionType | CommonNavigationAction | StackActionType;

type StackResult = StackState | PartialState<StackState> | null;

const hasSamePanes = (left: PaneMap, right: PaneMap): boolean =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(right).every(([key, pane]) => left[key] === pane);

/**
 * A stack router that also keeps which pane each route belongs to, for a navigator that shows two
 * panes on a wide window and one on a narrow one. Opening, folding and unfolding are its own
 * actions; every other action is the stack router's, and only closes the panes of closed routes.
 */
export const PaneRouter = ({
  paneConfig,
  ...stackOptions
}: PaneRouterOptions): Router<PaneStackState, PaneRouterAction> => {
  const stack = StackRouter(stackOptions);

  // The panes of the routes a result keeps: a closed route leaves nothing behind.
  const settle = (result: StackResult, previous: PaneStackState): PaneStackState | null => {
    if (result === null || result === previous || result.stale === true) {
      return result as PaneStackState | null;
    }

    const kept = result as StackState & Partial<PaneStackState>;

    return {
      ...kept,
      panes: retainPanes(kept.panes ?? previous.panes, kept.routes),
    } as PaneStackState;
  };

  // The route the stack router builds for a push, without pushing it.
  const created = (
    state: PaneStackState,
    route: PaneRoute,
    config: RouterConfigOptions,
  ): { pushed: PaneStackState; route: PaneStackRoute } | null => {
    const pushed = stack.getStateForAction(
      state,
      StackActions.push(route.name, route.params),
      config,
    ) as PaneStackState | null;
    const built = pushed?.routes.at(-1);

    return pushed === null || built === undefined ? null : { pushed, route: built };
  };

  const open = (
    state: PaneStackState,
    payload: { openerKey: string; route: PaneRoute },
    config: RouterConfigOptions,
  ): PaneStackState | null => {
    const next = created(state, payload.route, config);

    if (next === null) {
      return null;
    }

    const opened = openFrom(
      state.routes,
      unfoldAssignment(state.routes, state.panes, paneConfig),
      payload.openerKey,
      next.route,
    );

    // An opener that is neither a route nor a static default changed nothing.
    if (opened.routes === state.routes) {
      return null;
    }

    return {
      ...next.pushed,
      routes: opened.routes,
      index: opened.routes.length - 1,
      panes: opened.panes,
    };
  };

  const showDefault = (
    state: PaneStackState,
    payload: { pane: Pane; route: PaneRoute },
    config: RouterConfigOptions,
  ): PaneStackState | null => {
    const next = created(state, payload.route, config);

    if (next === null) {
      return null;
    }

    const panes = unfoldAssignment(state.routes, state.panes, paneConfig);
    const inPane = routesOfPane(state.routes, panes, paneConfig, payload.pane);

    // The user already tapped something in this pane.
    if (inPane.some((route) => route.isDefault !== true)) {
      return state;
    }

    const others = state.routes.filter((route) => !inPane.includes(route));
    const routes = [...others.slice(0, 1), { ...next.route, isDefault: true }, ...others.slice(1)];

    return {
      ...next.pushed,
      routes,
      index: routes.length - 1,
      panes: { ...retainPanes(panes, others), [next.route.key]: payload.pane },
    };
  };

  const fold = (state: PaneStackState): PaneStackState => {
    const folded = foldAssignment(state.routes, state.panes);

    return folded.routes.length === state.routes.length
      ? state
      : { ...state, routes: folded.routes, index: folded.routes.length - 1, panes: folded.panes };
  };

  const unfold = (state: PaneStackState): PaneStackState => {
    const panes = unfoldAssignment(state.routes, state.panes, paneConfig);

    return hasSamePanes(state.panes, panes) ? state : { ...state, panes };
  };

  // A route that replaces another one stays in the other one's pane.
  const carryReplacedPane = (settled: PaneStackState, previous: PaneStackState): PaneStackState => {
    const replaced = settled.routes.findIndex(
      (route, index) => route.key !== previous.routes[index]?.key,
    );
    const pane = foldMap(maybe(previous.routes[replaced]), (route) => previous.panes[route.key]);

    return pane === undefined || replaced === -1
      ? settled
      : { ...settled, panes: { ...settled.panes, [settled.routes[replaced].key]: pane } };
  };

  const delegate = (
    state: PaneStackState,
    action: CommonNavigationAction | StackActionType,
    config: RouterConfigOptions,
  ): PaneStackState | null => {
    const settled = settle(stack.getStateForAction(state, action, config), state);

    return action.type === 'REPLACE' && settled !== null && settled !== state
      ? carryReplacedPane(settled, state)
      : settled;
  };

  return {
    ...stack,

    getInitialState: (config) => ({ ...stack.getInitialState(config), panes: {} }),

    getRehydratedState: (partialState, config) => {
      const rehydrated = stack.getRehydratedState(partialState, config) as PaneStackState;

      // The stack router hands back a state that is already complete untouched.
      if (rehydrated === partialState) {
        return rehydrated;
      }

      const stored = (partialState as Partial<PaneStackState>).panes ?? {};

      return { ...rehydrated, panes: retainPanes(stored, rehydrated.routes) };
    },

    getStateForRouteNamesChange: (state, options) =>
      settle(stack.getStateForRouteNamesChange(state, options), state) as PaneStackState,

    getStateForRouteFocus: (state, key) =>
      settle(stack.getStateForRouteFocus(state, key), state) as PaneStackState,

    getStateForAction: (state, action, config) =>
      match(action)
        .with({ type: 'PANE_OPEN' }, ({ payload }) => open(state, payload, config))
        .with({ type: 'PANE_FOLD' }, () => fold(state))
        .with({ type: 'PANE_UNFOLD' }, () => unfold(state))
        .with({ type: 'PANE_SHOW_DEFAULT' }, ({ payload }) => showDefault(state, payload, config))
        .otherwise((standard) => delegate(state, standard, config)),

    actionCreators: { ...stack.actionCreators, ...PaneActions },
  };
};
