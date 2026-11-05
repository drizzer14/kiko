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

const isWholeWindow = (config: PaneConfig, route: RouteLike): boolean =>
  config.wholeWindowRoutes?.includes(route.name) === true;

// A stored pane wins; otherwise the root takes the root pane and every other route, a default
// included, takes the other one. Position alone decides, so a state without a pane map (a route
// pushed while folded, a reminder rebuild) never puts a deeper route in the list pane. A route in
// the layer gets a pane here too, which nothing reads: the layer is not a pane.
const resolvePanes = (routes: readonly RouteLike[], panes: PaneMap, config: PaneConfig): Pane[] =>
  routes.map(
    (route, index) =>
      panes[route.key] ?? (index === 0 ? config.rootPane : oppositePane(config.rootPane)),
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

// Where the layer starts: the first listed route above the root, or past the last route when
// there is none. A listed root is an ordinary route of its pane.
const layerStartOf = (routes: readonly RouteLike[], config: PaneConfig): number => {
  const start = routes.findIndex((route, index) => index > 0 && isWholeWindow(config, route));

  return start === -1 ? routes.length : start;
};

/**
 * The routes of the layer over both panes: the first route the config lists as a whole-window
 * route, and every route above it, in stack order. A route over such a route stays in the layer, so
 * its Back is there; none when the config lists no route in the stack.
 */
export const layerRoutesOf = <Route extends RouteLike>(
  routes: readonly Route[],
  config: PaneConfig,
): Route[] => routes.slice(layerStartOf(routes, config));

/**
 * The routes of one pane, in stack order: only those below the layer, which shows the rest.
 */
export const routesOfPane = <Route extends RouteLike>(
  routes: readonly Route[],
  panes: PaneMap,
  config: PaneConfig,
  pane: Pane,
): Route[] => {
  const resolved = resolvePanes(routes, panes, config);
  const layerStart = layerStartOf(routes, config);

  return routes.filter((_route, index) => index < layerStart && resolved[index] === pane);
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
 * default. The router makes a static default a real route first (`realizeStaticDefault` in
 * pane-router.ts), so the opener it hands over is that route; the branch here that puts a static
 * default's key right above the root is only the fallback for an opener the router did not realize,
 * which is what it hands over for a whole-window route: that route opens over both panes, so the
 * static default beside it is never made real.
 *
 * A whole-window route closes nothing: it opens over every route the panes hold, and Back returns
 * to them as they were. Its entry in the pane map is the detail pane's by position, which nothing
 * reads, since the layer is not a pane.
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
  const below = isWholeWindow(config, next)
    ? routes
    : routes.slice(0, Math.max(openerIndex, 0) + 1);
  const kept = below
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
  const resolved = resolvePanes(routes, panes, config);

  return Object.fromEntries(routes.map((route, index) => [route.key, resolved[index]]));
};
