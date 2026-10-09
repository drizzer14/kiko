import { render, screen } from '@testing-library/react-native';
import type { FoldRegion, LayoutMode } from '@kiko/display-regions';

import '@kiko/design-system/unistyles';

import type { PaneConfig } from '../pane-assignment';
import type { PaneStackRoute, PaneStackState } from '../pane-router';

import PaneStackView from '.';
import type { NativeStackViewProps } from './pane-stack-view.props';

// The window reports one pane; the view is given the mode it shows, which wins.
const mockUseFoldRegion = jest.fn((): FoldRegion => null);
jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => 'single',
  useFoldRegion: () => mockUseFoldRegion(),
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

const mockNativeStackView = jest.fn();
jest.mock('@react-navigation/native-stack', () => {
  const { useContext } = require('react');
  const { View } = require('react-native');
  const { OpenInPaneContext } = require('../open-in-pane');
  const { PaneVisibilityContext } = require('../pane-visibility');

  return {
    NativeStackView: (props: { state: { routes: { key: string }[] } }) => {
      mockNativeStackView(props, useContext(PaneVisibilityContext), useContext(OpenInPaneContext));

      return <View testID={`stack-${props.state.routes.map((route) => route.key).join('+')}`} />;
    },
  };
});

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
  routeNames: [],
  routes,
  preloadedRoutes: [],
  panes,
});

const HOME: PaneConfig = {
  rootPane: 'primary',
  companionDefault: { name: 'Statistics', isDefault: true },
};
const ACCOUNTS: PaneConfig = { rootPane: 'companion' };

const navigation = { dispatch: jest.fn() } as never as NativeStackViewProps['navigation'];
const descriptors = { shared: true } as never as NativeStackViewProps['descriptors'];
const describeStandIn = jest.fn((standIn: PaneStackRoute) => ({
  standIn,
  route: standIn,
  navigation: {},
}));
const describeRoute = describeStandIn as never as NativeStackViewProps['describe'];

const renderView = (state: PaneStackState, paneConfig: PaneConfig, mode: LayoutMode = 'columns') =>
  render(
    <PaneStackView
      mode={mode}
      state={state}
      navigation={navigation}
      descriptors={descriptors}
      describe={describeRoute}
      paneConfig={paneConfig}
    />,
  );

const renderedProps = () =>
  mockNativeStackView.mock.calls.map(
    ([props]) => props as { state: PaneStackState; descriptors: object; navigation: object },
  );

describe('PaneStackView', () => {
  beforeEach(() => {
    mockNativeStackView.mockClear();
    mockUseFoldRegion.mockReturnValue(null);
  });

  it('renders one native stack with the whole state in single mode', async () => {
    const state = stackState([route('accounts'), route('account')]);

    await renderView(state, ACCOUNTS, 'single');

    expect(renderedProps()).toHaveLength(1);
    expect(renderedProps()[0].state).toBe(state);
    expect(renderedProps()[0].descriptors).toBe(descriptors);
    expect(renderedProps()[0].navigation).toBe(navigation);
  });

  it('keeps a default route out of the single stack', async () => {
    await renderView(
      stackState([route('accounts'), route('first', 'AccountDetail', { isDefault: true })]),
      ACCOUNTS,
      'single',
    );

    expect(renderedProps()[0].state.routes.map((entry) => entry.key)).toEqual(['accounts']);
  });

  it.each(['columns', 'rows'] as const)(
    'renders one native stack for each pane, with that pane’s routes, in %s',
    async (mode) => {
      const state = stackState([route('accounts'), route('account'), route('form')], {
        accounts: 'companion',
        account: 'primary',
        form: 'companion',
      });

      await renderView(state, ACCOUNTS, mode);

      expect(screen.getByTestId('two-pane-companion')).toBeTruthy();
      expect(screen.getByTestId('stack-accounts+form')).toBeTruthy();
      expect(screen.getByTestId('stack-account')).toBeTruthy();

      const [companion, primary] = renderedProps();

      expect(companion.state.routes.map((entry) => entry.key)).toEqual(['accounts', 'form']);
      expect(companion.state.index).toBe(1);
      expect(primary.state.routes.map((entry) => entry.key)).toEqual(['account']);
      expect(primary.state.index).toBe(0);
    },
  );

  it('gives every pane the shared navigation, the shared descriptors and the stack key', async () => {
    const state = stackState([route('accounts'), route('account')], {
      accounts: 'companion',
      account: 'primary',
    });

    await renderView(state, ACCOUNTS);

    for (const props of renderedProps()) {
      expect(props.navigation).toBe(navigation);
      expect(props.descriptors).toBe(descriptors);
      expect(props.state.key).toBe('stack-key');
    }
  });

  it('shows the pane default through a synthetic route, described as a placeholder', async () => {
    await renderView(stackState([route('home', 'Home')], { home: 'primary' }), HOME);

    const [companion, primary] = renderedProps();

    expect(companion.state.routes).toEqual([
      { key: 'pane-default:companion', name: 'Statistics', params: undefined, isDefault: true },
    ]);
    expect(companion.descriptors).toHaveProperty('pane-default:companion');
    expect(describeStandIn).toHaveBeenCalledWith(companion.state.routes[0], true);
    expect(primary.state.routes.map((entry) => entry.key)).toEqual(['home']);
  });

  it('shows no stack in a pane that has neither a route nor a default', async () => {
    await renderView(stackState([route('accounts')], { accounts: 'companion' }), ACCOUNTS);

    expect(renderedProps()).toHaveLength(1);
    expect(screen.getByTestId('two-pane-primary').children).toHaveLength(0);
  });

  describe('context for the screens', () => {
    it('marks the top route of each pane visible, and hands over the navigator dispatch', async () => {
      const state = stackState([route('accounts'), route('account'), route('form')], {
        accounts: 'companion',
        account: 'primary',
        form: 'companion',
      });

      await renderView(state, ACCOUNTS);

      for (const [, visibility, dispatch] of mockNativeStackView.mock.calls) {
        expect(visibility.isTabFocused).toBe(true);
        expect([...visibility.visibleKeys].sort()).toEqual(['account', 'form']);
        expect(dispatch).toBe(navigation.dispatch);
      }
    });

    it('lists the synthetic default as the visible route of its pane', async () => {
      await renderView(stackState([route('home', 'Home')], { home: 'primary' }), HOME);

      const [, visibility] = mockNativeStackView.mock.calls[0];

      expect([...visibility.visibleKeys].sort()).toEqual(['home', 'pane-default:companion']);
    });

    describe('the route on top of the primary pane', () => {
      const SETTINGS: PaneConfig = {
        rootPane: 'companion',
        primaryDefault: { name: 'Categories', isDefault: true },
      };

      const primaryRouteOf = () => mockNativeStackView.mock.calls[0][1].primaryRoute;

      it('is the tapped route, with its params', async () => {
        const state = stackState(
          [route('accounts'), route('account', 'AccountDetail', { params: { accountId: 'a' } })],
          { accounts: 'companion', account: 'primary' },
        );

        await renderView(state, ACCOUNTS);

        expect(primaryRouteOf()).toEqual({
          name: 'AccountDetail',
          params: { accountId: 'a' },
          isDefault: false,
        });
      });

      it('is the config default while the pane holds no route', async () => {
        await renderView(stackState([route('settings')], { settings: 'companion' }), SETTINGS);

        expect(primaryRouteOf()).toEqual({
          name: 'Categories',
          params: undefined,
          isDefault: true,
        });
      });

      it('is flagged a default for a runtime default route', async () => {
        const state = stackState(
          [
            route('accounts'),
            route('account', 'AccountDetail', { isDefault: true, params: { accountId: 'a' } }),
          ],
          { accounts: 'companion', account: 'primary' },
        );

        await renderView(state, ACCOUNTS);

        expect(primaryRouteOf().isDefault).toBe(true);
        expect(primaryRouteOf().name).toBe('AccountDetail');
      });

      it('is null while the pane has neither a route nor a default', async () => {
        await renderView(stackState([route('accounts')], { accounts: 'companion' }), ACCOUNTS);

        expect(primaryRouteOf()).toBeNull();
      });

      it('keeps one value while the route stays the same', async () => {
        const state = stackState([route('accounts')], { accounts: 'companion' });
        const view = await renderView(state, SETTINGS);
        const first = primaryRouteOf();

        await view.rerender(
          <PaneStackView
            mode="columns"
            state={{ ...state }}
            navigation={navigation}
            descriptors={descriptors}
            describe={describeRoute}
            paneConfig={SETTINGS}
          />,
        );

        expect(mockNativeStackView.mock.calls.at(-1)?.[1].primaryRoute).toBe(first);
      });
    });

    it('has no pane visibility in single mode, but still hands over the dispatch', async () => {
      await renderView(stackState([route('accounts')]), ACCOUNTS, 'single');

      const [, visibility, dispatch] = mockNativeStackView.mock.calls[0];

      expect(visibility).toBeNull();
      expect(dispatch).toBe(navigation.dispatch);
    });
  });
});
