import maybe, { foldMap } from 'fnts/maybe';

import type { PaneConfig, PaneDefault, PaneMap, RouteLike } from './pane-assignment.types';

const PANES = ['companion', 'primary'] as const;

export type Pane = (typeof PANES)[number];

const OPPOSITE: Record<Pane, Pane> = { companion: 'primary', primary: 'companion' };

const DEFAULT_OF: Record<Pane, 'companionDefault' | 'primaryDefault'> = {
  companion: 'companionDefault',
  primary: 'primaryDefault',
};

const oppositePane = (pane: Pane): Pane => OPPOSITE[pane];

// A default from the pane config is not in the stack, so it has no route key of its own. The key
// it is shown under names its pane, which lets a screen shown as a default name itself as the
// opener.
export const defaultRouteKey = (pane: Pane): string => `pane-default:${pane}`;

export const paneOfDefaultKey = (key: string): Pane | undefined =>
  PANES.find((pane) => defaultRouteKey(pane) === key);

// A stored pane wins; otherwise a route takes the pane opposite to the route below it, and the
// root takes the root pane. A default is never "the route below": a fold drops it, and the routes
// above it must not change pane.
const resolvePanes = (routes: readonly RouteLike[], panes: PaneMap, rootPane: Pane): Pane[] => {
  const resolved: Pane[] = [];
  let below: Pane | undefined;

  for (const route of routes) {
    const pane = panes[route.key] ?? foldMap(maybe(below), oppositePane) ?? rootPane;

    resolved.push(pane);

    if (route.isDefault !== true) {
      below = pane;
    }
  }

  return resolved;
};

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
 * Opens `next` in the pane opposite to the opener's: every route above the opener is closed first,
 * so a second row replaces the first instead of stacking beside it. An opener that is a default
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
    panes: { ...retainPanes(panes, kept), [next.key]: oppositePane(openerPane) },
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
 * A pane for every route: a stored one is kept, a route pushed while folded takes the pane
 * opposite to the route below it, and the root takes the root pane.
 */
export const unfoldAssignment = (
  routes: readonly RouteLike[],
  panes: PaneMap,
  config: PaneConfig,
): PaneMap => {
  const resolved = resolvePanes(routes, panes, config.rootPane);

  return Object.fromEntries(routes.map((route, index) => [route.key, resolved[index]]));
};
