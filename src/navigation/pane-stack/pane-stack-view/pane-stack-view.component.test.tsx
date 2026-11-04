import { StyleSheet } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { render, screen } from '@testing-library/react-native';
import type { FoldRegion, LayoutMode, TabBarEdge, VerticalBarEdge } from '@kiko/display-regions';

import '@kiko/design-system/unistyles';

import type { PaneConfig } from '../pane-assignment';
import type { PaneStackRoute, PaneStackState } from '../pane-router';

import PaneStackView from '.';
import type { NativeStackViewProps } from './pane-stack-view.props';

// The window reports one pane; the view is given the mode it shows, which wins.
const mockUseFoldRegion = jest.fn((): FoldRegion => null);
const mockUseTabBarEdge = jest.fn((): TabBarEdge => 'none');
const mockUseVerticalBarEdge = jest.fn((): VerticalBarEdge => 'none');
jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => 'single',
  useFoldRegion: () => mockUseFoldRegion(),
  useTabBarEdge: () => mockUseTabBarEdge(),
  useVerticalBarEdge: () => mockUseVerticalBarEdge(),
}));

let mockTabBarHeight = 64;
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => mockTabBarHeight,
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

const HAIRLINE = darkTheme.layout.hairline;

const mockWindow = { width: 951, height: 669, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockDetailMounted = jest.fn();
const mockNativeStackView = jest.fn();
const mockFixedContentMargin = jest.fn();
jest.mock('@react-navigation/native-stack', () => {
  const { useContext, useEffect } = require('react');
  const { View } = require('react-native');
  const { FixedContentMarginContext } = require('react-native-screens');
  const { OpenInPaneContext } = require('../open-in-pane');
  const { PaneVisibilityContext } = require('../pane-visibility');

  const DetailScreen = () => {
    useEffect(() => {
      mockDetailMounted();
    }, []);

    return <View testID="detail-screen" />;
  };

  return {
    NativeStackView: (props: { state: { routes: { key: string; name: string }[] } }) => {
      mockNativeStackView(props, useContext(PaneVisibilityContext), useContext(OpenInPaneContext));
      mockFixedContentMargin(useContext(FixedContentMarginContext));

      return (
        <View testID={`stack-${props.state.routes.map((route) => route.key).join('+')}`}>
          {props.state.routes.some((route) => route.name === 'WideDetail') && <DetailScreen />}
        </View>
      );
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
const HOME_ROOT: PaneConfig = { rootPane: 'primary' };

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
    mockDetailMounted.mockClear();
    mockUseFoldRegion.mockReturnValue(null);
    mockUseTabBarEdge.mockReturnValue('none');
    mockUseVerticalBarEdge.mockReturnValue('none');
    mockTabBarHeight = 64;
    mockWindow.width = 951;
    mockWindow.height = 669;
  });

  describe('a large window rotating between landscape and portrait', () => {
    const state = stackState([route('home', 'Home'), route('detail', 'WideDetail')], {
      home: 'primary',
      detail: 'companion',
    });

    const renderAt = (width: number, height: number) => {
      mockWindow.width = width;
      mockWindow.height = height;

      return (
        <PaneStackView
          mode="columns"
          state={state}
          navigation={navigation}
          descriptors={descriptors}
          describe={describeRoute}
          paneConfig={HOME_ROOT}
        />
      );
    };

    const companionWidth = () =>
      StyleSheet.flatten(screen.getByTestId('two-pane-companion').props.style).width;

    it('splits the window in equal halves and keeps the slice route keys and one mounted detail screen from 1376 x 1032 to 1032 x 1376 and back', async () => {
      const view = await render(renderAt(1376, 1032));

      expect(companionWidth()).toBe((1376 - HAIRLINE) / 2);

      await view.rerender(renderAt(1032, 1376));

      expect(companionWidth()).toBe((1032 - HAIRLINE) / 2);
      expect(StyleSheet.flatten(screen.getByTestId('two-pane-primary').props.style).left).toBe(
        (1032 - HAIRLINE) / 2 + HAIRLINE,
      );

      await view.rerender(renderAt(1376, 1032));

      expect(companionWidth()).toBe((1376 - HAIRLINE) / 2);
      expect(screen.getByTestId('stack-detail')).toBeTruthy();
      expect(screen.getByTestId('stack-home')).toBeTruthy();
      expect(screen.getAllByTestId('detail-screen')).toHaveLength(1);
      expect(mockDetailMounted).toHaveBeenCalledTimes(1);

      const lastTwo = renderedProps().slice(-2);

      expect(lastTwo.map((props) => props.state.routes.map((entry) => entry.key))).toEqual([
        ['detail'],
        ['home'],
      ]);
    });
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
        form: 'primary',
      });

      await renderView(state, ACCOUNTS, mode);

      expect(screen.getByTestId('two-pane-companion')).toBeTruthy();
      expect(screen.getByTestId('stack-accounts')).toBeTruthy();
      expect(screen.getByTestId('stack-account+form')).toBeTruthy();

      const [companion, primary] = renderedProps();

      expect(companion.state.routes.map((entry) => entry.key)).toEqual(['accounts']);
      expect(companion.state.index).toBe(0);
      expect(primary.state.routes.map((entry) => entry.key)).toEqual(['account', 'form']);
      expect(primary.state.index).toBe(1);
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

  // A pane's native large title takes its leading inset from the pane's distance to the window's
  // edge, so each pane's stack asks the native side for the content's fixed margin instead,
  // unless the native tab bar is at the bottom, which keeps UIKit's margin.
  describe('the fixed content margin of a pane’s native stack', () => {
    const state = stackState([route('accounts'), route('account')], {
      accounts: 'companion',
      account: 'primary',
    });

    const renderInWindow = async (width: number, height: number, mode: LayoutMode) => {
      mockWindow.width = width;
      mockWindow.height = height;

      await renderView(state, ACCOUNTS, mode);
    };

    it.each([
      ['a 13-inch iPad in landscape', 1376, 1032, 'columns'],
      ['a 13-inch iPad in portrait', 1032, 1376, 'columns'],
      ['a small Stage Manager column split', 1032, 683, 'columns'],
      ['a small Stage Manager row split', 683, 909, 'rows'],
    ] as const)(
      'is the content’s side padding in both panes of %s when the tab bar is at the top',
      async (_name, width, height, mode) => {
        mockUseTabBarEdge.mockReturnValue('top');

        await renderInWindow(width, height, mode);

        expect(mockFixedContentMargin.mock.calls).toEqual([
          [darkTheme.spacing(4)],
          [darkTheme.spacing(4)],
        ]);
      },
    );

    it.each([
      ['the Duo inner window in landscape, bar at the bottom', 951, 669, 'columns', 'bottom'],
      ['the Duo inner window in portrait, bar at the bottom', 669, 951, 'rows', 'bottom'],
      ['the Duo inner window in landscape, no bar found', 951, 669, 'columns', 'none'],
      ['the Duo inner window in portrait, no bar found', 669, 951, 'rows', 'none'],
    ] as const)('is 0 in both panes of %s', async (_name, width, height, mode, tabBarEdge) => {
      mockUseTabBarEdge.mockReturnValue(tabBarEdge);

      await renderInWindow(width, height, mode);

      expect(mockFixedContentMargin.mock.calls).toEqual([[0], [0]]);
    });

    it.each([
      ['a leading side bar', 'leading', 'none'],
      ['a trailing side bar', 'trailing', 'none'],
      ['a vertical bar trait with no native bar found', 'none', 'leading'],
    ] as const)(
      'is the content’s side padding in both panes with %s',
      async (_name, tabBarEdge, verticalBarEdge) => {
        mockUseTabBarEdge.mockReturnValue(tabBarEdge);
        mockUseVerticalBarEdge.mockReturnValue(verticalBarEdge);

        await renderInWindow(1376, 1032, 'columns');

        expect(mockFixedContentMargin.mock.calls).toEqual([
          [darkTheme.spacing(5)],
          [darkTheme.spacing(5)],
        ]);
      },
    );

    it.each([
      ['the Duo outer window in landscape', 1350, 900, 'columns'],
      ['the Duo inner window in landscape', 951, 669, 'columns'],
    ] as const)(
      'is the content’s side padding in both panes of %s, whose side bar is not at the bottom',
      async (_name, width, height, mode) => {
        mockUseTabBarEdge.mockReturnValue('bottom');
        mockUseVerticalBarEdge.mockReturnValue('leading');

        await renderInWindow(width, height, mode);

        expect(mockFixedContentMargin.mock.calls).toEqual([
          [darkTheme.spacing(5)],
          [darkTheme.spacing(5)],
        ]);
      },
    );

    it.each([
      ['a leading side bar', 'leading'],
      ['a trailing side bar', 'trailing'],
    ] as const)(
      'is the base 16 pt side padding for the single native stack under %s',
      async (_name, tabBarEdge) => {
        mockUseTabBarEdge.mockReturnValue(tabBarEdge);

        await renderView(stackState([route('accounts'), route('account')]), ACCOUNTS, 'single');

        expect(mockFixedContentMargin.mock.calls).toEqual([[darkTheme.spacing(4)]]);
      },
    );

    it('is the base 16 pt side padding for the single native stack when the bar reports its whole window height', async () => {
      mockUseTabBarEdge.mockReturnValue('bottom');
      mockTabBarHeight = 678;
      mockWindow.width = 466;
      mockWindow.height = 678;

      await renderView(stackState([route('accounts'), route('account')]), ACCOUNTS, 'single');

      expect(mockFixedContentMargin.mock.calls).toEqual([[darkTheme.spacing(4)]]);
    });

    it.each([
      ['a top bar', 'top'],
      ['a bottom bar', 'bottom'],
    ] as const)(
      'is 0, which leaves UIKit’s margins alone, for the single native stack under %s',
      async (_name, tabBarEdge) => {
        mockUseTabBarEdge.mockReturnValue(tabBarEdge);

        await renderView(stackState([route('accounts'), route('account')]), ACCOUNTS, 'single');

        expect(mockFixedContentMargin.mock.calls).toEqual([[0]]);
      },
    );
  });

  describe('context for the screens', () => {
    it('marks the top route of each pane visible, and hands over the navigator dispatch', async () => {
      const state = stackState([route('accounts'), route('account'), route('form')], {
        accounts: 'companion',
        account: 'primary',
        form: 'primary',
      });

      await renderView(state, ACCOUNTS);

      for (const [, visibility, dispatch] of mockNativeStackView.mock.calls) {
        expect(visibility.isTabFocused).toBe(true);
        expect([...visibility.visibleKeys].sort()).toEqual(['accounts', 'form']);
        expect(dispatch).toBe(navigation.dispatch);
      }
    });

    it('lists the synthetic default as the visible route of its pane', async () => {
      await renderView(stackState([route('home', 'Home')], { home: 'primary' }), HOME);

      const [, visibility] = mockNativeStackView.mock.calls[0];

      expect([...visibility.visibleKeys].sort()).toEqual(['home', 'pane-default:companion']);
    });

    describe('the first route of the detail pane', () => {
      const SETTINGS: PaneConfig = {
        rootPane: 'companion',
        primaryDefault: { name: 'Categories', isDefault: true },
      };

      const detailRouteOf = () => mockNativeStackView.mock.calls[0][1].detailRoute;

      it('is the tapped route, with its params', async () => {
        const state = stackState(
          [route('accounts'), route('account', 'AccountDetail', { params: { accountId: 'a' } })],
          { accounts: 'companion', account: 'primary' },
        );

        await renderView(state, ACCOUNTS);

        expect(detailRouteOf()).toEqual({
          key: 'account',
          name: 'AccountDetail',
          params: { accountId: 'a' },
          isDefault: false,
        });
      });

      it('stays the first page of the detail pane while a deeper step covers it', async () => {
        const state = stackState(
          [
            route('accounts'),
            route('account', 'AccountDetail', { params: { accountId: 'a' } }),
            route('form', 'HoldingForm'),
          ],
          { accounts: 'companion', account: 'primary', form: 'primary' },
        );

        await renderView(state, ACCOUNTS);

        expect(detailRouteOf()).toEqual({
          key: 'account',
          name: 'AccountDetail',
          params: { accountId: 'a' },
          isDefault: false,
        });
      });

      it('is the companion route, not the list, when the list is the primary pane', async () => {
        const state = stackState(
          [
            route('home', 'Home'),
            route('form', 'TransactionForm'),
            route('holding', 'HoldingForm'),
          ],
          { home: 'primary', form: 'companion', holding: 'companion' },
        );

        await renderView(state, HOME);

        expect(detailRouteOf()).toEqual({
          key: 'form',
          name: 'TransactionForm',
          params: undefined,
          isDefault: false,
        });
      });

      it('is the config default while the pane holds no route', async () => {
        await renderView(stackState([route('settings')], { settings: 'companion' }), SETTINGS);

        expect(detailRouteOf()).toEqual({
          key: 'pane-default:primary',
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

        expect(detailRouteOf().isDefault).toBe(true);
        expect(detailRouteOf().name).toBe('AccountDetail');
      });

      it('is null while the pane has neither a route nor a default', async () => {
        await renderView(stackState([route('accounts')], { accounts: 'companion' }), ACCOUNTS);

        expect(detailRouteOf()).toBeNull();
      });

      it('keeps one value while the route stays the same', async () => {
        const state = stackState([route('accounts')], { accounts: 'companion' });
        const view = await renderView(state, SETTINGS);
        const first = detailRouteOf();

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

        expect(mockNativeStackView.mock.calls.at(-1)?.[1].detailRoute).toBe(first);
      });
    });

    it('has no pane visibility in single mode, but still hands over the dispatch', async () => {
      await renderView(stackState([route('accounts')]), ACCOUNTS, 'single');

      const [, visibility, dispatch] = mockNativeStackView.mock.calls[0];

      expect(visibility).toBeNull();
      expect(dispatch).toBe(navigation.dispatch);
    });
  });

  describe('a whole-window route on top', () => {
    const WHOLE_HOME: PaneConfig = { ...HOME, wholeWindowRoutes: ['Tables'] };
    const onTables = stackState([route('home', 'Home'), route('tables', 'Tables')], {
      home: 'primary',
      tables: 'primary',
    });

    // Testing Library leaves a pane hidden from accessibility out of its queries by default.
    const WITH_HIDDEN = { includeHiddenElements: true } as const;

    const styleOf = (testID: string) =>
      StyleSheet.flatten(screen.getByTestId(testID, WITH_HIDDEN).props.style);

    const frameOf = (testID: string) => {
      const { left, top, width, height } = styleOf(testID);

      return { x: left, y: top, width, height };
    };

    it('gives its pane the whole window, hides the other pane and draws no divider', async () => {
      await renderView(onTables, WHOLE_HOME);

      expect(frameOf('two-pane-primary')).toEqual({ x: 0, y: 0, width: 951, height: 669 });
      expect(styleOf('two-pane-primary').opacity).toBeUndefined();
      expect(styleOf('two-pane-companion').opacity).toBe(0);
      expect(screen.getByTestId('two-pane-companion', WITH_HIDDEN).props.pointerEvents).toBe(
        'none',
      );
      expect(screen.queryByTestId('two-pane-divider')).toBeNull();
    });

    it('keeps the default beside it mounted in its pane, with Tables the only visible route', async () => {
      await renderView(onTables, WHOLE_HOME);

      expect(screen.getByTestId('stack-pane-default:companion', WITH_HIDDEN)).toBeTruthy();
      expect(screen.getByTestId('stack-home+tables')).toBeTruthy();

      for (const [, visibility] of mockNativeStackView.mock.calls) {
        expect([...visibility.visibleKeys]).toEqual(['tables']);
      }
    });

    it('is the companion pane that takes the window when Tables sits above a real route there', async () => {
      const state = stackState(
        [route('home', 'Home'), route('statistics', 'Statistics'), route('tables', 'Tables')],
        { home: 'primary', statistics: 'companion', tables: 'companion' },
      );

      await renderView(state, WHOLE_HOME);

      expect(frameOf('two-pane-companion')).toEqual({ x: 0, y: 0, width: 951, height: 669 });
      expect(styleOf('two-pane-primary').opacity).toBe(0);

      for (const [, visibility] of mockNativeStackView.mock.calls) {
        expect([...visibility.visibleKeys]).toEqual(['tables']);
      }
    });

    it('keeps every screen mounted, with no frame that shows nothing, as Tables opens and closes', async () => {
      const covered = stackState(
        [route('home', 'Home'), route('detail', 'WideDetail'), route('tables', 'Tables')],
        { home: 'primary', detail: 'companion', tables: 'companion' },
      );
      const open = stackState([route('home', 'Home'), route('detail', 'WideDetail')], {
        home: 'primary',
        detail: 'companion',
      });
      const element = (state: PaneStackState) => (
        <PaneStackView
          mode="columns"
          state={state}
          navigation={navigation}
          descriptors={descriptors}
          describe={describeRoute}
          paneConfig={WHOLE_HOME}
        />
      );

      const view = await render(element(open));
      await view.rerender(element(covered));

      expect(styleOf('two-pane-primary').opacity).toBe(0);
      expect(screen.getByTestId('detail-screen')).toBeTruthy();

      await view.rerender(element(open));

      expect(screen.getAllByTestId('detail-screen')).toHaveLength(1);
      expect(mockDetailMounted).toHaveBeenCalledTimes(1);
    });

    it('shares the window again once a route covers Tables', async () => {
      const state = stackState(
        [route('home', 'Home'), route('tables', 'Tables'), route('form', 'TransactionForm')],
        { home: 'primary', tables: 'primary', form: 'companion' },
      );

      await renderView(state, WHOLE_HOME);

      expect(screen.getByTestId('two-pane-divider')).toBeTruthy();
      expect(frameOf('two-pane-primary').width).toBeLessThan(951);
    });

    it('changes nothing with one pane, or for a config that lists no whole-window route', async () => {
      await renderView(onTables, WHOLE_HOME, 'single');

      expect(renderedProps()).toHaveLength(1);
      expect(screen.queryByTestId('two-pane-primary')).toBeNull();

      mockNativeStackView.mockClear();
      await renderView(onTables, HOME);

      expect(screen.getByTestId('two-pane-divider')).toBeTruthy();
    });

    describe('the fixed content margin', () => {
      it('is the single stack’s under a side bar, 16 pt, in both panes', async () => {
        mockUseTabBarEdge.mockReturnValue('leading');
        mockWindow.width = 1376;
        mockWindow.height = 1032;

        await renderView(onTables, WHOLE_HOME);

        expect(mockFixedContentMargin.mock.calls).toEqual([
          [darkTheme.spacing(4)],
          [darkTheme.spacing(4)],
        ]);
      });

      it('is 0 under a top bar, as the single stack, where a split pane has the side padding', async () => {
        mockUseTabBarEdge.mockReturnValue('top');
        mockWindow.width = 1376;
        mockWindow.height = 1032;

        await renderView(onTables, WHOLE_HOME);

        expect(mockFixedContentMargin.mock.calls).toEqual([[0], [0]]);
      });
    });
  });
});
