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
import { match, P } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';

import {
  foldAssignment,
  openFrom,
  oppositePane,
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
      payload: { route: PaneRoute; isPlaceholder: boolean };
      source?: string;
      target?: string;
    }
  | { type: 'PANE_CLOSE'; payload: { routeKey: string }; source?: string; target?: string };

export const PaneActions = {
  open: (openerKey: string, name: string, params?: object) =>
    ({ type: 'PANE_OPEN', payload: { openerKey, route: { name, params } } }) as const,
  fold: () => ({ type: 'PANE_FOLD' }) as const,
  unfold: () => ({ type: 'PANE_UNFOLD' }) as const,
  showDefault: (name: string, params?: object, isPlaceholder = false) =>
    ({
      type: 'PANE_SHOW_DEFAULT',
      payload: { route: { name, params }, isPlaceholder },
    }) as const,
  close: (routeKey: string) => ({ type: 'PANE_CLOSE', payload: { routeKey } }) as const,
} satisfies Record<string, (...args: never[]) => PaneActionType>;

type StackState = StackNavigationState<ParamListBase>;

export type PaneStackRoute = StackState['routes'][number] & {
  isDefault?: boolean;
  isPlaceholder?: boolean;
};

export type PaneStackState = Omit<StackState, 'routes'> & {
  routes: PaneStackRoute[];
  // The pane of each route key that has one stored. See `PaneMap`.
  panes: PaneMap;
};

export type PaneRouterOptions = StackRouterOptions & {
  paneConfig: PaneConfig;
  // Whether the navigator shows two panes right now. With one, a covered route sends no action
  // the user can reach, so the stack router's rules stay as they are, and `PANE_SHOW_DEFAULT`
  // shows nothing.
  isSplit: () => boolean;
};

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
  isSplit,
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
      paneConfig,
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
    payload: { route: PaneRoute; isPlaceholder: boolean },
    config: RouterConfigOptions,
  ): PaneStackState | null => {
    // With one pane there is nothing to fill, and a default would sit on top of what the user
    // opened.
    if (!isSplit()) {
      return state;
    }

    const next = created(state, payload.route, config);

    if (next === null) {
      return null;
    }

    // A default fills the detail pane only: the list pane always holds the root.
    const detailPane = oppositePane(paneConfig.rootPane);
    const panes = unfoldAssignment(state.routes, state.panes, paneConfig);
    const inPane = routesOfPane(state.routes, panes, paneConfig, detailPane);

    // The user already tapped something in this pane.
    if (inPane.some((route) => route.isDefault !== true)) {
      return state;
    }

    const others = state.routes.filter((route) => !inPane.includes(route));
    const shown = {
      ...next.route,
      isDefault: true,
      ...(payload.isPlaceholder ? { isPlaceholder: true } : {}),
    };
    const routes = [...others.slice(0, 1), shown, ...others.slice(1)];

    return {
      ...next.pushed,
      routes,
      index: routes.length - 1,
      panes: { ...retainPanes(panes, others), [next.route.key]: detailPane },
    };
  };

  // Closes one route and no other. A caller may send it after the route has already gone (the
  // page and the list both notice a deleted entity, and a list and a page can both close the same
  // one), which must not close whatever is on top.
  const close = (
    state: PaneStackState,
    routeKey: string,
    config: RouterConfigOptions,
  ): PaneStackState | null =>
    state.routes.some((route) => route.key === routeKey)
      ? standard(
          { ...state, panes: unfoldAssignment(state.routes, state.panes, paneConfig) },
          { ...StackActions.pop(), source: routeKey, target: state.key },
          config,
        )
      : state;

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

  const standard = (
    state: PaneStackState,
    action: CommonNavigationAction | StackActionType,
    config: RouterConfigOptions,
  ): PaneStackState | null => {
    const settled = settle(stack.getStateForAction(state, action, config), state);

    return action.type === 'REPLACE' && settled !== null && settled !== state
      ? carryReplacedPane(settled, state)
      : settled;
  };

  // The route an action comes from, when the navigator shows two panes and has that route. The
  // stack router takes the focused route to be the caller, which is only true of the route on top.
  const sourceOf = (
    state: PaneStackState,
    action: CommonNavigationAction | StackActionType,
  ): string | undefined => {
    const { source } = action;

    return isSplit() && state.routes.some((route) => route.key === source) ? source : undefined;
  };

  const isDefaultRoute = (state: PaneStackState, key: string): boolean =>
    state.routes.some((route) => route.key === key && route.isDefault === true);

  // A native back of several screens closes screens of the one pane that goes back; the stack
  // router would count them in stack order, across both panes. A pane keeps its first screen.
  const dismiss = (state: PaneStackState, source: string, count: number): PaneStackState | null => {
    const panes = unfoldAssignment(state.routes, state.panes, paneConfig);
    const closing =
      foldMap(maybe(panes[source]), (pane) => {
        const own = routesOfPane(state.routes, panes, paneConfig, pane);
        const at = own.findIndex((route) => route.key === source);

        return own.slice(Math.max(at - count + 1, 1), at + 1);
      }) ?? [];

    if (closing.length === 0) {
      return null;
    }

    const routes = state.routes.filter((route) => !closing.includes(route));
    const closed: PaneStackState = { ...state, routes, index: routes.length - 1, panes };

    return settle(closed, state);
  };

  const fromBystander = (
    state: PaneStackState,
    source: string,
    action: CommonNavigationAction | StackActionType,
    config: RouterConfigOptions,
  ): PaneStackState | null =>
    match(action)
      .with({ type: P.union('NAVIGATE', 'PUSH') }, ({ payload }) =>
        open(state, { openerKey: source, route: payload }, config),
      )
      .with({ type: P.union('GO_BACK', 'POP', 'POP_TO', 'REPLACE') }, () =>
        // A route in the middle closing must not move the panes of the routes above it.
        standard(
          { ...state, panes: unfoldAssignment(state.routes, state.panes, paneConfig) },
          { ...action, target: state.key },
          config,
        ),
      )
      .otherwise(() => standard(state, action, config));

  const delegate = (
    state: PaneStackState,
    action: CommonNavigationAction | StackActionType,
    config: RouterConfigOptions,
  ): PaneStackState | null => {
    const source = sourceOf(state, action);

    if (source === undefined) {
      return standard(state, action, config);
    }

    // A default is on top, yet the user never acted on it: what it opens goes opposite it, and it
    // is the pane's floor, so there is nothing for it to go back to.
    if (isDefaultRoute(state, source)) {
      return action.type === 'GO_BACK' || action.type === 'POP'
        ? state
        : fromBystander(state, source, action, config);
    }

    if (action.type === 'POP' && action.payload.count > 1) {
      return dismiss(state, source, action.payload.count);
    }

    return source === state.routes[state.index]?.key
      ? standard(state, action, config)
      : fromBystander(state, source, action, config);
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
        .with({ type: 'PANE_CLOSE' }, ({ payload }) => close(state, payload.routeKey, config))
        .otherwise((standard) => delegate(state, standard, config)),

    actionCreators: { ...stack.actionCreators, ...PaneActions },
  };
};
