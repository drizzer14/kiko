import maybe, { foldMap } from 'fnts/maybe';

import type { PaneConfig, PaneDefault, PaneMap, RouteLike } from './pane-assignment.types';

const PANES = ['companion', 'primary'] as const;

export type Pane = (typeof PANES)[number];

const OPPOSITE: Record<Pane, Pane> = { companion: 'primary', primary: 'companion' };

const DEFAULT_OF: Record<Pane, 'companionDefault' | 'primaryDefault'> = {
  companion: 'companionDefault',
  primary: 'primaryDefault',
};

// The pane of every route above the root: the list stays where it is, and a page opens, goes
// deeper and closes in this one.
export const oppositePane = (pane: Pane): Pane => OPPOSITE[pane];

// A default from the pane config is not in the stack, so it has no route key of its own. The key
// it is shown under names its pane, which lets a screen shown as a default name itself as the
// opener.
export const defaultRouteKey = (pane: Pane): string => `pane-default:${pane}`;

export const paneOfDefaultKey = (key: string): Pane | undefined =>
  PANES.find((pane) => defaultRouteKey(pane) === key);

// A stored pane wins; otherwise the root takes the root pane and every other route, a default
// included, takes the other one. Position alone decides, so a state without a pane map (a route
// pushed while folded, a reminder rebuild) never puts a deeper route in the list pane.
const resolvePanes = (routes: readonly RouteLike[], panes: PaneMap, rootPane: Pane): Pane[] =>
  routes.map(
    (route, index) => panes[route.key] ?? (index === 0 ? rootPane : oppositePane(rootPane)),
  );

// The keys the routes still hold, so a closed route never leaves its pane behind.
export const retainPanes = (panes: PaneMap, routes: readonly RouteLike[]): PaneMap =>
  Object.fromEntries(
    routes.flatMap(
      (route) => foldMap(maybe(panes[route.key]), (pane) => [[route.key, pane] as const]) ?? [],
    ),
  );

const withoutDefaultFlag = <Route extends RouteLike>(route: Route): Route => {
  const { isDefault, ...rest } = route;

  return rest as Route;
};

/**
 * The routes of one pane, in stack order.
 */
export const routesOfPane = <Route extends RouteLike>(
  routes: readonly Route[],
  panes: PaneMap,
  config: PaneConfig,
  pane: Pane,
): Route[] => {
  const resolved = resolvePanes(routes, panes, config.rootPane);

  return routes.filter((_route, index) => resolved[index] === pane);
};

/**
 * What a pane shows when it has no route, or null when it shows nothing.
 */
export const paneDefault = (config: PaneConfig, pane: Pane): PaneDefault | null =>
  config[DEFAULT_OF[pane]] ?? null;

/**
 * Opens `next` in the detail pane, the one that is not the list's, whichever pane the opener is
 * in: every route above the opener is closed first, so a tap in the list replaces the detail
 * stack and a tap in the detail pane goes one step deeper in it. An opener that is a default
 * route becomes a real route (the user acted on it), unless it is a placeholder, which stays a
 * default. A static default stands in the stack right above the root.
 *
 * `panes` must name the opener's pane; an opener it cannot place leaves everything as it was.
 */
export const openFrom = <Route extends RouteLike>(
  routes: Route[],
  panes: PaneMap,
  openerKey: string,
  next: Route,
  config: PaneConfig,
): { routes: Route[]; panes: PaneMap } => {
  const openerIndex = routes.findIndex((route) => route.key === openerKey);
  const openerPane = panes[openerKey] ?? paneOfDefaultKey(openerKey);

  if (openerPane === undefined) {
    return { routes, panes };
  }

  // A route that `next` reuses (a screen with an id) moves to the top instead of appearing twice.
  const kept = routes
    .slice(0, Math.max(openerIndex, 0) + 1)
    .filter((route) => route.key !== next.key)
    .map((route) =>
      route.key === openerKey && route.isPlaceholder !== true ? withoutDefaultFlag(route) : route,
    );

  return {
    routes: [...kept, next],
    panes: { ...retainPanes(panes, kept), [next.key]: oppositePane(config.rootPane) },
  };
};

/**
 * The stack the outer display shows: defaults go, and every tapped route keeps its pane so an
 * unfold puts it back where it was.
 */
export const foldAssignment = <Route extends RouteLike>(
  routes: Route[],
  panes: PaneMap,
): { routes: Route[]; panes: PaneMap } => {
  const kept = routes.filter((route) => route.isDefault !== true);

  return { routes: kept, panes: retainPanes(panes, kept) };
};

/**
 * A pane for every route: a stored one is kept, and a route pushed while folded takes the detail
 * pane, so the unfolded detail pane shows the last route of the folded stack with a way back to
 * the one below it, and the list shows the root.
 */
export const unfoldAssignment = (
  routes: readonly RouteLike[],
  panes: PaneMap,
  config: PaneConfig,
): PaneMap => {
  const resolved = resolvePanes(routes, panes, config.rootPane);

  return Object.fromEntries(routes.map((route, index) => [route.key, resolved[index]]));
};
