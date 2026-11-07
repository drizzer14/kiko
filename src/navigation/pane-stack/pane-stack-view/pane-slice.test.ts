import { createElement, Fragment } from 'react';
import { render, screen } from '@testing-library/react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import type { PaneConfig } from '../pane-assignment';
import type { PaneStackRoute, PaneStackState } from '../pane-router';

import type { StandInOptions } from './stand-in-options';
import type { NativeStackViewProps } from './pane-stack-view.props';
import { layerSlice, paneSlice, type StandIns, withoutDefaultRoutes } from './pane-slice';

const route = (key: string, name = key, extra: Partial<PaneStackRoute> = {}): PaneStackRoute => ({
  key,
  name,
  ...extra,
});

const stackState = (
  routes: PaneStackRoute[],
  panes: PaneStackState['panes'] = {},
): PaneStackState => ({
  stale: false,
  type: 'stack',
  key: 'stack-key',
  index: routes.length - 1,
  routeNames: ['Accounts', 'AccountDetail', 'Form', 'Statement'],
  routes,
  preloadedRoutes: [],
  panes,
});

const ACCOUNTS: PaneConfig = { rootPane: 'companion' };
const HOME: PaneConfig = {
  rootPane: 'primary',
  companionDefault: { name: 'Statement', params: { range: 'year' }, isDefault: true },
};

const descriptors = {
  accounts: { id: 'accounts-descriptor' },
} as never as NativeStackViewProps['descriptors'];
const describeStandIn = jest.fn((standIn: PaneStackRoute) => ({
  id: `described-${standIn.key}`,
  route: standIn,
  navigation: {} as Record<string, (...args: unknown[]) => unknown>,
  options: { title: 'Statement', headerLargeTitle: true } as NativeStackNavigationOptions,
}));
const describeRoute = describeStandIn as never as NativeStackViewProps['describe'];
const dispatch = jest.fn();
const setOptions = jest.fn();
type NativeStackDescriptor = NativeStackViewProps['descriptors'][string];

const standIns = (options: StandInOptions = {}): StandIns => ({ options, setOptions });

describe('paneSlice', () => {
  beforeEach(() => {
    describeStandIn.mockClear();
    dispatch.mockClear();
    setOptions.mockClear();
  });

  it('keeps the routes of the pane, in stack order, on the stack state', () => {
    const state = stackState([route('accounts'), route('account'), route('form')], {
      accounts: 'companion',
      account: 'primary',
      form: 'companion',
    });
    const slice = paneSlice(
      state,
      ACCOUNTS,
      'companion',
      descriptors,
      describeRoute,
      dispatch,
      standIns(),
    );

    expect(slice?.standInKey).toBeNull();
    expect(slice?.state.routes.map((entry) => entry.key)).toEqual(['accounts', 'form']);
    expect(slice?.state.index).toBe(1);
    expect(slice?.state.key).toBe('stack-key');
    expect(slice?.state.preloadedRoutes).toEqual([]);
    expect(slice?.descriptors).toBe(descriptors);
    expect(describeStandIn).not.toHaveBeenCalled();
  });

  it('stands the pane default in as a synthetic route when the pane has none, and describes it', () => {
    const slice = paneSlice(
      stackState([route('home', 'Home')], { home: 'primary' }),
      HOME,
      'companion',
      descriptors,
      describeRoute,
      dispatch,
      standIns(),
    );

    expect(slice?.standInKey).toBe('pane-default:companion');
    expect(slice?.state.routes).toEqual([
      {
        key: 'pane-default:companion',
        name: 'Statement',
        params: { range: 'year' },
        isDefault: true,
      },
    ]);
    expect(slice?.state.index).toBe(0);
    expect(slice?.descriptors).toEqual({
      ...descriptors,
      'pane-default:companion': expect.objectContaining({ id: 'described-pane-default:companion' }),
    });
    expect(describeStandIn).toHaveBeenCalledWith(slice?.state.routes[0], true);
  });

  it('has no slice for a pane with neither a route nor a default', () => {
    expect(
      paneSlice(
        stackState([route('accounts')]),
        ACCOUNTS,
        'primary',
        descriptors,
        describeRoute,
        dispatch,
        standIns(),
      ),
    ).toBeNull();
  });

  describe('the options a default set on itself', () => {
    const defaultDescriptor = (options: StandInOptions): NativeStackDescriptor => {
      const slice = paneSlice(
        stackState([route('home', 'Home')], { home: 'primary' }),
        HOME,
        'companion',
        descriptors,
        describeRoute,
        dispatch,
        standIns(options),
      );

      return (slice?.descriptors ?? descriptors)['pane-default:companion'];
    };

    it('keeps the static options of a default that set none', () => {
      expect(defaultDescriptor({}).options).toEqual({
        title: 'Statement',
        headerLargeTitle: true,
      });
    });

    it('lays what the default set over the static options, key by key', () => {
      const { options } = defaultDescriptor({
        'pane-default:companion': { headerLargeTitle: false, headerTitle: '' },
      });

      expect(options).toEqual({ title: 'Statement', headerLargeTitle: false, headerTitle: '' });
    });

    it('ignores what another default set', () => {
      expect(
        defaultDescriptor({ 'pane-default:primary': { headerLargeTitle: false } }).options,
      ).toEqual({ title: 'Statement', headerLargeTitle: true });
    });

    it("sends the default's setOptions to the store under the default's key", () => {
      const { navigation } = defaultDescriptor({});

      navigation.setOptions({ headerTitle: '' });

      expect(setOptions).toHaveBeenCalledTimes(1);
      expect(setOptions).toHaveBeenCalledWith('pane-default:companion', { headerTitle: '' });
    });
  });
});

// The layer holds Tables over a placeholder root that renders nothing. Every row here pins a prop
// the layer's stack is given, never what the native stack does with it.
describe('layerSlice', () => {
  const WHOLE_HOME: PaneConfig = { ...HOME, wholeWindowRoutes: ['Tables'] };

  const layerDescriptors = {
    home: { id: 'home-descriptor' },
    tables: {
      id: 'tables-descriptor',
      options: { title: 'Tables', headerLargeTitle: false },
    },
    form: { id: 'form-descriptor', options: { title: 'Form' } },
  } as never as NativeStackViewProps['descriptors'];

  const sliceOf = (routes: PaneStackRoute[], config: PaneConfig = WHOLE_HOME) =>
    layerSlice(stackState(routes), config, layerDescriptors, describeRoute);

  const atRest = () => sliceOf([route('home', 'Home')]);
  const onTables = () => sliceOf([route('home', 'Home'), route('tables', 'Tables')]);

  const rootOf = (slice: ReturnType<typeof layerSlice>): NativeStackDescriptor =>
    (slice?.descriptors ?? layerDescriptors)['pane-layer-root'];

  beforeEach(() => {
    describeStandIn.mockClear();
  });

  it('is none for a config that lists no whole-window route', () => {
    expect(sliceOf([route('home', 'Home'), route('tables', 'Tables')], HOME)).toBeNull();
  });

  it('holds only the placeholder root, named as the first route, when nothing is in the layer', () => {
    const slice = atRest();

    expect(slice?.state.routes).toEqual([{ key: 'pane-layer-root', name: 'Home' }]);
    expect(slice?.state.index).toBe(0);
    expect(slice?.state.key).toBe('stack-key');
    expect(slice?.state.preloadedRoutes).toEqual([]);
  });

  it('puts the layer routes after the root, the last one focused', () => {
    const slice = sliceOf([
      route('home', 'Home'),
      route('statistics', 'Statistics'),
      route('tables', 'Tables'),
      route('form', 'Form'),
    ]);

    expect(slice?.state.routes.map((entry) => entry.key)).toEqual([
      'pane-layer-root',
      'tables',
      'form',
    ]);
    expect(slice?.state.index).toBe(2);
  });

  it('describes the root as a placeholder, and draws nothing for it', async () => {
    const slice = onTables();

    expect(describeStandIn).toHaveBeenCalledWith(slice?.state.routes[0], true);

    await render(createElement(Fragment, null, rootOf(slice).render()));

    expect(screen.toJSON()).toBeNull();
  });

  // The whole options object is compared: the root takes nothing from the route it is named after,
  // whose own options (a large title, for one) would show in a bar that is meant to be empty.
  // Root and Tables share one navigation bar. A root with no header hides that bar when a swipe
  // back starts, so while Tables is in the layer the root keeps a header of its own, one that
  // is drawn as Tables' bar is (it takes the appearance options from Tables) and shows no title;
  // at rest the layer shows no header at all. Jest proves the props only, never the UIKit
  // transition between the two bars or the bar's hide at the end of a pop.
  it('gives the root a title-less page on a clear ground and no header while it holds only the root', () => {
    expect(rootOf(atRest()).options).toEqual({
      title: '',
      contentStyle: { backgroundColor: 'transparent' },
      headerShown: false,
    });
  });

  it('gives the root a title-less page on a clear ground and a shown, empty header with Tables in it', () => {
    expect(rootOf(onTables()).options).toEqual({
      title: '',
      contentStyle: { backgroundColor: 'transparent' },
      headerShown: true,
      headerTitle: '',
    });
  });

  describe('with appearance options on the pages of the layer', () => {
    const headerStyle = { backgroundColor: 'black' };
    const headerLargeStyle = { backgroundColor: 'transparent' };
    const headerBackground = () => null;

    const sliceWith = (
      tables: NativeStackNavigationOptions,
      form: NativeStackNavigationOptions,
    ): ReturnType<typeof layerSlice> =>
      layerSlice(
        stackState([route('home', 'Home'), route('tables', 'Tables'), route('form', 'Form')]),
        WHOLE_HOME,
        {
          ...layerDescriptors,
          tables: { id: 'tables-descriptor', options: tables },
          form: { id: 'form-descriptor', options: form },
        } as never as NativeStackViewProps['descriptors'],
        describeRoute,
      );

    it('takes the appearance options from Tables and nothing else, so the bar is drawn as its own', () => {
      const slice = sliceWith(
        {
          title: 'Tables',
          headerBackTitle: 'Back',
          headerLargeTitle: true,
          headerBackground,
          headerBlurEffect: 'systemChromeMaterial',
          headerLargeStyle,
          headerLargeTitleShadowVisible: false,
          headerShadowVisible: true,
          headerStyle,
          headerTransparent: true,
        },
        {},
      );

      expect(rootOf(slice).options).toEqual({
        title: '',
        contentStyle: { backgroundColor: 'transparent' },
        headerShown: true,
        headerTitle: '',
        headerBackground,
        headerBlurEffect: 'systemChromeMaterial',
        headerLargeStyle,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: true,
        headerStyle,
        headerTransparent: true,
      });
    });

    it('takes them from the first page of the layer, the one the root is shared with', () => {
      const { options } = rootOf(sliceWith({ headerBlurEffect: 'regular' }, { headerStyle }));

      expect(options.headerBlurEffect).toBe('regular');
      expect(options.headerStyle).toBeUndefined();
    });
  });

  it('shows the root header for a layer of two as well', () => {
    const { options } = rootOf(
      sliceOf([route('home', 'Home'), route('tables', 'Tables'), route('form', 'Form')]),
    );

    expect(options.headerShown).toBe(true);
  });

  it('overlays a listed route in the layer with a bare chevron Back and no back menu', () => {
    const slice = onTables();

    expect(slice?.descriptors.tables).toEqual({
      id: 'tables-descriptor',
      options: {
        title: 'Tables',
        headerLargeTitle: false,
        headerBackButtonDisplayMode: 'minimal',
        headerBackButtonMenuEnabled: false,
      },
    });
  });

  it('leaves the descriptor of a route over Tables, and every other, as they are', () => {
    const slice = sliceOf([
      route('home', 'Home'),
      route('tables', 'Tables'),
      route('form', 'Form'),
    ]);

    expect(slice?.descriptors.form).toBe(layerDescriptors.form);
    expect(slice?.descriptors.home).toBe(layerDescriptors.home);
  });

  it('puts no overlay on a descriptor when Tables is not in the layer', () => {
    expect(atRest()?.descriptors.tables).toBe(layerDescriptors.tables);
  });
});

describe('withoutDefaultRoutes', () => {
  it('returns the state itself when it holds no default route', () => {
    const state = stackState([route('accounts'), route('account')]);

    expect(withoutDefaultRoutes(state)).toBe(state);
  });

  it('drops the default routes and focuses the last one left', () => {
    const state = stackState([
      route('accounts'),
      route('first', 'AccountDetail', { isDefault: true }),
      route('form'),
    ]);
    const shown = withoutDefaultRoutes(state);

    expect(shown.routes.map((entry) => entry.key)).toEqual(['accounts', 'form']);
    expect(shown.index).toBe(1);
  });

  it('focuses the root when only defaults stood above it', () => {
    const shown = withoutDefaultRoutes(
      stackState([route('accounts'), route('first', 'AccountDetail', { isDefault: true })]),
    );

    expect(shown.routes.map((entry) => entry.key)).toEqual(['accounts']);
    expect(shown.index).toBe(0);
  });
});
