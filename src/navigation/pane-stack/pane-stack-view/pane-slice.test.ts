import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import type { PaneConfig } from '../pane-assignment';
import type { PaneStackRoute, PaneStackState } from '../pane-router';

import type { StandInOptions } from './stand-in-options';
import type { NativeStackViewProps } from './pane-stack-view.props';
import { paneSlice, type StandIns, withoutDefaultRoutes } from './pane-slice';

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
