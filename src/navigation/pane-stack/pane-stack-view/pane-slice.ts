import maybe, { foldMap } from 'fnts/maybe';
import { createElement, Fragment } from 'react';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import {
  defaultRouteKey,
  layerRoutesOf,
  type Pane,
  type PaneConfig,
  paneDefault,
  routesOfPane,
} from '../pane-assignment';
import type { PaneStackRoute, PaneStackState } from '../pane-router';

import type { StandInOptions } from './stand-in-options';
import { standInNavigation } from './stand-in-navigation';
import type { NativeStackViewProps } from './pane-stack-view.props';

type PaneSlice = {
  state: PaneStackState;
  descriptors: NativeStackViewProps['descriptors'];
  // The key of the default the slice shows as a synthetic route, or null when it has routes.
  standInKey: string | null;
};

// What a screen shown as a default has set on itself: what it has set, and how it sets more.
export type StandIns = {
  options: StandInOptions;
  setOptions: (key: string, options: NativeStackNavigationOptions) => void;
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
 * The options the default set on itself lie over the ones it is described with, which are static.
 */
export const paneSlice = (
  state: PaneStackState,
  config: PaneConfig,
  pane: Pane,
  descriptors: NativeStackViewProps['descriptors'],
  describe: NativeStackViewProps['describe'],
  dispatch: Parameters<typeof standInNavigation>[1],
  standIns: StandIns,
): PaneSlice | null => {
  const routes = routesOfPane(state.routes, state.panes, config, pane);

  if (routes.length > 0) {
    return { state: stateOf(state, routes), descriptors, standInKey: null };
  }

  return (
    foldMap(maybe(paneDefault(config, pane)), (shown) => {
      const standIn: PaneStackRoute = {
        key: defaultRouteKey(pane),
        name: shown.name,
        params: shown.params,
        isDefault: true,
      };

      const described = standInNavigation(describe(standIn, true), dispatch, (options) =>
        standIns.setOptions(standIn.key, options),
      );

      return {
        state: stateOf(state, [standIn]),
        descriptors: {
          ...descriptors,
          [standIn.key]: {
            ...described,
            options: { ...described.options, ...standIns.options[standIn.key] },
          },
        },
        standInKey: standIn.key,
      };
    }) ?? null
  );
};

export type LayerSlice = Pick<PaneSlice, 'state' | 'descriptors'> & {
  // The route on top of the layer, or null while it holds only its placeholder root.
  topKey: string | null;
};

const LAYER_ROOT_KEY = 'pane-layer-root';

// What the layer's root shows nothing of: no title, and a ground that lets the panes through
// behind the sliding page.
const LAYER_ROOT_OPTIONS: NativeStackNavigationOptions = {
  title: '',
  contentStyle: { backgroundColor: 'transparent' },
};

// A header that is there and shows no title. Root and the page over it share one navigation bar, so
// a root with no header hides the page's own bar when a swipe back starts; a root with this one
// keeps it, and the swipe can be cancelled with the bar in place.
const LAYER_ROOT_HEADER: NativeStackNavigationOptions = {
  headerShown: true,
  headerTitle: '',
};

// The options that decide how a bar's background is drawn: its fill, blur, shadow, custom
// background and large-title ground. UIKit moves the shared bar from one page's appearance to the
// other's during the swipe, so a root that differs in any of them fades the bar's background away.
// The page over the root has them from its stack's `screenOptions` or its own, and the root, which
// is described apart from both, takes them from that page. Its title, back button and items stay
// its own, and so does `headerLargeTitle`: it also shapes the bar's background, but the root never
// takes a large title, a deliberate exception (the root's bar is the plain one the swipe ends on).
const BAR_APPEARANCE_OPTIONS = [
  'headerBackground',
  'headerBlurEffect',
  'headerLargeStyle',
  'headerLargeTitleShadowVisible',
  'headerShadowVisible',
  'headerStyle',
  'headerTransparent',
] as const satisfies readonly (keyof NativeStackNavigationOptions)[];

const barAppearanceOf = (options: NativeStackNavigationOptions): NativeStackNavigationOptions =>
  Object.fromEntries(BAR_APPEARANCE_OPTIONS.map((name) => [name, options[name]]));

// The page under Tables in this stack is the untitled placeholder root, so a Back label or a menu
// of earlier titles would list nothing: the button is the chevron alone.
const LAYER_BACK_OPTIONS: NativeStackNavigationOptions = {
  headerBackButtonDisplayMode: 'minimal',
  headerBackButtonMenuEnabled: false,
};

/**
 * The stack of the layer over both panes: a placeholder root that draws nothing, then the routes
 * from the first whole-window route up, which the panes leave out. The root is there at rest too,
 * so the stack is never made afresh and Tables is pushed onto it, with the header the root shows
 * only while a page is over it. None for a config that lists no whole-window route.
 */
export const layerSlice = (
  state: PaneStackState,
  config: PaneConfig,
  descriptors: NativeStackViewProps['descriptors'],
  describe: NativeStackViewProps['describe'],
): LayerSlice | null => {
  const listed = config.wholeWindowRoutes ?? [];
  const first = state.routes[0];

  if (listed.length === 0 || first === undefined) {
    return null;
  }

  const routes = layerRoutesOf(state.routes, config);
  const root: PaneStackRoute = { key: LAYER_ROOT_KEY, name: first.name };
  // The root's bar is shared with the layer's first page: a swipe back from it ends on the root.
  const page = routes.at(0);
  const overlaid = Object.fromEntries(
    routes
      .filter(({ key, name }) => listed.includes(name) && key in descriptors)
      .map(({ key }) => [
        key,
        { ...descriptors[key], options: { ...descriptors[key].options, ...LAYER_BACK_OPTIONS } },
      ]),
  );

  return {
    state: stateOf(state, [root, ...routes]),
    topKey: routes.at(-1)?.key ?? null,
    descriptors: {
      ...descriptors,
      [root.key]: {
        ...describe(root, true),
        // The descriptor type wants an element, not null: an empty fragment draws nothing.
        render: () => createElement(Fragment),
        options: {
          ...LAYER_ROOT_OPTIONS,
          ...(page === undefined
            ? { headerShown: false }
            : { ...barAppearanceOf(descriptors[page.key]?.options ?? {}), ...LAYER_ROOT_HEADER }),
        },
      },
      ...overlaid,
    },
  };
};

/**
 * The state one pane shows: a default route is a choice for a second pane, so it stays out of
 * the only one.
 */
export const withoutDefaultRoutes = (state: PaneStackState): PaneStackState => {
  const routes = state.routes.filter((route) => route.isDefault !== true);

  return routes.length === state.routes.length ? state : stateOf(state, routes);
};
