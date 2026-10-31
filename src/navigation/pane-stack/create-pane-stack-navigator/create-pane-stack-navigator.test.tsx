import {
  createNavigationContainerRef,
  createNavigatorFactory,
  NavigationContainer,
  NavigationMetaContext,
  type NavigationProp,
  type ParamListBase,
  TabRouter,
  useNavigation,
  useNavigationBuilder,
  useRoute,
} from '@react-navigation/native';
import { Pressable, Text, View } from 'react-native';
import type { LayoutMode } from '@kiko/display-regions';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { resetTabStackOnBlur } from '@kiko/navigation/reset-tab-stack-on-blur';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { type ComponentType, type ReactNode, useContext, useEffect, useState } from 'react';

import '@kiko/design-system/unistyles';

import { useOpenInPane } from '../open-in-pane';
import type { PaneConfig } from '../pane-assignment';
import { SETTLE_DELAY_MS } from '../use-settled-layout-mode';
import { PaneVisibilityContext, useIsScreenVisible } from '../pane-visibility';

import { createPaneStackNavigator } from '.';

const mockModeStore = {
  mode: 'columns' as LayoutMode,
  listeners: new Set<() => void>(),
};

jest.mock('@kiko/display-regions', () => {
  const { useSyncExternalStore } = require('react');

  return {
    useLayoutMode: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockModeStore.listeners.add(listener);

          return () => mockModeStore.listeners.delete(listener);
        },
        () => mockModeStore.mode,
      ),
    useFoldRegion: () => null,
    useTabBarEdge: () => 'none',
    useVerticalBarEdge: () => 'none',
  };
});

const emitMode = async (mode: LayoutMode): Promise<void> => {
  await act(async () => {
    mockModeStore.mode = mode;

    for (const listener of mockModeStore.listeners) {
      listener();
    }
  });
};

const elapse = async (milliseconds: number): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
};

type StubParams = { opens?: string };

// Whether every screen navigates the moment it finds itself in two panes.
const navigatesWhenInTwoPanes = { current: false };

// How many times each screen mounted: a transient frame must not remount anything.
const mounts: Record<string, number | undefined> = {};

// A screen that shows whether it is visible, and a button that opens `params.opens` in the
// opposite pane.
const StubScreen = () => {
  const route = useRoute();
  const isVisible = useIsScreenVisible();
  const openInPane = useOpenInPane();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { opens } = (route.params ?? {}) as StubParams;
  const isInTwoPanes = useContext(PaneVisibilityContext) !== null;

  useEffect(() => {
    mounts[route.name] = (mounts[route.name] ?? 0) + 1;
  }, [route.name]);

  // A child effect runs in the very commit that moves the navigator to two panes.
  useEffect(() => {
    if (navigatesWhenInTwoPanes.current && isInTwoPanes) {
      navigation.navigate('Form');
    }
  }, [isInTwoPanes, navigation]);

  return (
    <View testID={`screen-${route.name}`}>
      <Text testID={`visible-${route.name}`}>{String(isVisible)}</Text>

      {opens !== undefined && (
        <Pressable testID={`open-${route.name}`} onPress={() => openInPane(opens)} />
      )}

      <Pressable testID={`navigate-${route.name}`} onPress={() => navigation.navigate('Form')} />
      <Pressable testID={`go-back-${route.name}`} onPress={() => navigation.goBack()} />
    </View>
  );
};

const PaneStack = createPaneStackNavigator<ParamListBase>();
const ParentStack = createNativeStackNavigator<ParamListBase>();

const CONFIG: PaneConfig = {
  rootPane: 'companion',
  primaryDefault: { name: 'Statement', isDefault: true },
};

const TabStack = () => (
  <PaneStack.Navigator
    paneConfig={CONFIG}
    screenOptions={{ headerShown: false }}
    screenListeners={resetTabStackOnBlur}
  >
    <PaneStack.Screen name="Accounts" component={StubScreen} initialParams={{ opens: 'Detail' }} />

    <PaneStack.Screen name="Detail" component={StubScreen} initialParams={{ opens: 'Form' }} />

    <PaneStack.Screen name="Form" component={StubScreen} />

    <PaneStack.Screen name="Statement" component={StubScreen} />
  </PaneStack.Navigator>
);

const navigationRef = createNavigationContainerRef<ParamListBase>();
const dispatched: string[] = [];
const dispatchedActions: { type: string; target?: string }[] = [];

const recordDispatches = () => {
  navigationRef.addListener('__unsafe_action__', ({ data }) => {
    dispatched.push(data.action.type);
    dispatchedActions.push(data.action);
  });
};

const renderApp = async () => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <ParentStack.Navigator screenOptions={{ headerShown: false }}>
        <ParentStack.Screen name="Tab" component={TabStack} />

        <ParentStack.Screen name="Other" component={StubScreen} />
      </ParentStack.Navigator>
    </NavigationContainer>,
  );
  recordDispatches();
};

const paneActions = () => dispatched.filter((type) => type.startsWith('PANE_'));

const stackRouteNames = (): string[] =>
  (navigationRef.getRootState()?.routes[0]?.state?.routes ?? []).map((route) => route.name);

const press = async (testID: string): Promise<void> => {
  await fireEvent.press(screen.getByTestId(testID));
};

describe('createPaneStackNavigator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockModeStore.mode = 'columns';
    dispatched.length = 0;
    dispatchedActions.length = 0;
    navigatesWhenInTwoPanes.current = false;

    for (const name of Object.keys(mounts)) {
      delete mounts[name];
    }
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('in two panes', () => {
    it('shows the root in its pane and the other pane default, both visible', async () => {
      await renderApp();

      expect(screen.getByTestId('screen-Accounts')).toBeTruthy();
      expect(screen.getByTestId('screen-Statement')).toBeTruthy();
      expect(screen.getByTestId('visible-Accounts').children).toEqual(['true']);
      expect(screen.getByTestId('visible-Statement').children).toEqual(['true']);
    });

    it('opens a screen in the opposite pane, in place of the default', async () => {
      await renderApp();

      await press('open-Accounts');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
      expect(screen.getByTestId('screen-Detail')).toBeTruthy();
      expect(screen.queryByTestId('screen-Statement')).toBeNull();
    });

    it('keeps the list beside the focused one visible, and not the page the form covers', async () => {
      await renderApp();

      await press('open-Accounts');
      await press('open-Detail');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail', 'Form']);
      expect(screen.getByTestId('visible-Accounts').children).toEqual(['true']);
      expect(screen.getByTestId('visible-Form').children).toEqual(['true']);
      expect(screen.queryByTestId('screen-Detail')).toBeNull();
    });

    it('opens the second row in place of the first instead of beneath it', async () => {
      await renderApp();

      await press('open-Accounts');
      await press('open-Accounts');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
    });

    it('opens what a plain navigate from the list asks for in the detail pane, in place of the page it shows', async () => {
      await renderApp();

      await press('open-Accounts');
      await press('navigate-Accounts');

      expect(stackRouteNames()).toEqual(['Accounts', 'Form']);
    });

    // The list is the only screen beside the focused one, and it has nothing to go back to.
    it('goes back from the focused screen of the detail pane, and the list stays', async () => {
      await renderApp();

      await press('open-Accounts');
      await press('open-Detail');
      await press('go-back-Form');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
      expect(screen.getByTestId('screen-Accounts')).toBeTruthy();
    });
  });

  describe('in one pane', () => {
    beforeEach(() => {
      mockModeStore.mode = 'single';
    });

    it('shows only the focused screen, visible by focus', async () => {
      await renderApp();

      expect(screen.getByTestId('screen-Accounts')).toBeTruthy();
      expect(screen.queryByTestId('screen-Statement')).toBeNull();
      expect(screen.getByTestId('visible-Accounts').children).toEqual(['true']);
    });

    it('opens a screen on top of the stack, as a plain push does', async () => {
      await renderApp();

      await press('open-Accounts');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
      expect(screen.getByTestId('screen-Detail')).toBeTruthy();
      expect(screen.queryByTestId('screen-Accounts')).toBeNull();
    });
  });

  describe('moving from one pane to two', () => {
    it('routes what a screen asks for as it appears under the new mode, not the old one', async () => {
      mockModeStore.mode = 'single';
      await renderApp();
      await press('open-Accounts');
      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);

      navigatesWhenInTwoPanes.current = true;
      await emitMode('columns');
      await elapse(SETTLE_DELAY_MS);

      expect(stackRouteNames()).toEqual(['Accounts', 'Form']);
    });
  });

  describe('folding and unfolding', () => {
    // The mocked mode stands for the resolved mode: a regular 900x700 window is `columns`, and a
    // resize to 700x700 resolves `single`. The detail route keeps its key through both folds, and
    // returns to the pane it was opened in.
    it('folds once when the window settles on one pane, and unfolds once when it returns', async () => {
      await renderApp();
      await press('open-Accounts');
      const detailKey = navigationRef.getRootState()?.routes[0]?.state?.routes[1]?.key;

      await emitMode('single');
      await elapse(SETTLE_DELAY_MS);

      expect(paneActions()).toEqual(['PANE_OPEN', 'PANE_FOLD']);
      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
      expect(screen.getByTestId('screen-Detail')).toBeTruthy();
      expect(screen.queryByTestId('screen-Accounts')).toBeNull();

      await emitMode('columns');
      await elapse(SETTLE_DELAY_MS);

      expect(paneActions()).toEqual(['PANE_OPEN', 'PANE_FOLD', 'PANE_UNFOLD']);
      expect(dispatched).toEqual(['PANE_OPEN', 'PANE_FOLD', 'PANE_UNFOLD']);
      expect(navigationRef.getRootState()?.routes[0]?.state?.routes[1]?.key).toBe(detailKey);
      expect(
        within(screen.getByTestId('two-pane-primary')).getByTestId('screen-Detail'),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('two-pane-companion')).getByTestId('screen-Accounts'),
      ).toBeTruthy();
    });

    it('survives the recorded burst of an outer display: one fold, no matter the transient rows', async () => {
      await renderApp();

      await emitMode('rows');
      await elapse(40);
      await emitMode('single');
      await elapse(SETTLE_DELAY_MS * 2);

      expect(paneActions()).toEqual(['PANE_FOLD']);
    });

    it('survives the recorded burst of an inner display: no fold for the transient single', async () => {
      await renderApp();

      await emitMode('single');
      await elapse(60);
      await emitMode('columns');
      await elapse(SETTLE_DELAY_MS * 2);

      expect(paneActions()).toEqual([]);
      expect(screen.getByTestId('screen-Accounts')).toBeTruthy();
      expect(screen.getByTestId('screen-Statement')).toBeTruthy();
      expect(mounts).toEqual({ Accounts: 1, Statement: 1 });
    });

    it('survives the burst of an outer display at rest: no unfold for the transient rows', async () => {
      mockModeStore.mode = 'single';
      await renderApp();

      await emitMode('rows');
      await elapse(40);
      await emitMode('single');
      await elapse(SETTLE_DELAY_MS * 2);

      expect(paneActions()).toEqual([]);
      expect(screen.getByTestId('screen-Accounts')).toBeTruthy();
      expect(screen.queryByTestId('screen-Statement')).toBeNull();
      expect(mounts).toEqual({ Accounts: 1 });
    });

    it('dispatches nothing for a rotation between the two split modes', async () => {
      await renderApp();

      await emitMode('rows');
      await elapse(SETTLE_DELAY_MS * 2);
      await emitMode('columns');
      await elapse(SETTLE_DELAY_MS * 2);

      expect(paneActions()).toEqual([]);
    });

    it('dispatches nothing when the same mode is reported again', async () => {
      await renderApp();

      await emitMode('columns');
      await emitMode('columns');
      await elapse(SETTLE_DELAY_MS * 2);

      expect(paneActions()).toEqual([]);
    });
  });

  describe('tapping the focused tab again', () => {
    let pressTab: ((type?: 'tabPress' | 'tabLongPress') => void) | undefined;

    // A tab navigator that hands the test a way to send the tab press. It renders every tab, so
    // the first stays mounted when another one takes focus.
    const TabNavigator = ({ children }: { children: ReactNode }) => {
      const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder(
        TabRouter,
        { children },
      );
      const tabRouteKey = state.routes[0].key;

      pressTab = (type = 'tabPress') =>
        navigation.emit({ type, target: tabRouteKey, canPreventDefault: true });

      return (
        <NavigationContent>
          {state.routes.map((route) => (
            <View key={route.key}>{descriptors[route.key]?.render()}</View>
          ))}
        </NavigationContent>
      );
    };
    const Tabs = createNavigatorFactory(TabNavigator)();

    const preventsTabPress = { current: false };
    const initialMeta: { current: object | undefined } = { current: undefined };
    const changeMeta: { current: ((meta: object | undefined) => void) | undefined } = {
      current: undefined,
    };
    const hideStack: { current: (() => void) | undefined } = { current: undefined };

    // The tab's stack as a parent tab navigator would hand it over: the meta is the test's, and
    // the stack can be taken away while its tab stays. No `screenListeners`, so leaving the tab
    // does not pop the stack on its own.
    const ConfiguredTabStack = () => {
      const [meta, setMeta] = useState(initialMeta.current);
      const [isShown, setIsShown] = useState(true);

      changeMeta.current = setMeta;
      hideStack.current = () => setIsShown(false);

      return (
        <NavigationMetaContext.Provider value={meta}>
          {isShown && (
            <PaneStack.Navigator paneConfig={CONFIG} screenOptions={{ headerShown: false }}>
              <PaneStack.Screen
                name="Accounts"
                component={StubScreen}
                initialParams={{ opens: 'Detail' }}
              />

              <PaneStack.Screen name="Detail" component={StubScreen} />

              <PaneStack.Screen name="Statement" component={StubScreen} />
            </PaneStack.Navigator>
          )}
        </NavigationMetaContext.Provider>
      );
    };

    const renderTabs = async (stack: ComponentType = TabStack, hasSecondTab = false) => {
      await render(
        <NavigationContainer ref={navigationRef}>
          <Tabs.Navigator>
            <Tabs.Screen
              name="Tab"
              component={stack}
              listeners={{
                tabPress: (event: { preventDefault: () => void }) => {
                  if (preventsTabPress.current) {
                    event.preventDefault();
                  }
                },
              }}
            />

            {hasSecondTab && <Tabs.Screen name="Second" component={StubScreen} />}
          </Tabs.Navigator>
        </NavigationContainer>,
      );
      recordDispatches();
    };

    beforeEach(() => {
      preventsTabPress.current = false;
      initialMeta.current = undefined;
    });

    const popsToTop = () => dispatchedActions.filter((action) => action.type === 'POP_TO_TOP');

    const stackKeys = (): (string | undefined)[] =>
      (navigationRef.getRootState()?.routes[0]?.state?.routes ?? []).map((route) => route.key);

    const tapTabAgain = async (): Promise<void> => {
      await act(async () => {
        pressTab?.();
      });
      await elapse(50);
    };

    const showDefault = async (): Promise<void> => {
      await act(async () => {
        navigationRef.dispatch({
          type: 'PANE_SHOW_DEFAULT',
          payload: { pane: 'primary', route: { name: 'Detail' } },
        });
      });
    };

    it('pops a page the user opened', async () => {
      await renderTabs();
      await press('open-Accounts');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);

      await tapTabAgain();

      expect(stackRouteNames()).toEqual(['Accounts']);
    });

    // Popping a runtime default would only put it back under a new key, remounting its screen.
    it('leaves a runtime default alone, so its screen does not remount', async () => {
      await renderTabs();
      await showDefault();
      const before = stackKeys();

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);

      await tapTabAgain();

      expect(stackKeys()).toEqual(before);
    });

    it('pops to the root of this stack, and only once', async () => {
      await renderTabs();
      await press('open-Accounts');

      await tapTabAgain();

      expect(popsToTop().map((action) => action.target)).toEqual([
        navigationRef.getRootState()?.routes[0]?.state?.key,
      ]);
    });

    // A pop the stack cannot handle is not recorded as an action; React Navigation reports it.
    it('pops nothing from a stack that holds only its root', async () => {
      const reportedError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      await renderTabs();

      await tapTabAgain();

      expect(reportedError).not.toHaveBeenCalled();
      expect(popsToTop()).toEqual([]);

      reportedError.mockRestore();
    });

    it('dispatches no pop for a runtime default alone', async () => {
      await renderTabs();
      await showDefault();

      await tapTabAgain();

      expect(popsToTop()).toEqual([]);
    });

    it('does not pop when the tab is not the focused one', async () => {
      await renderTabs(ConfiguredTabStack, true);
      await press('open-Accounts');
      await act(async () => navigationRef.navigate('Second'));

      await tapTabAgain();

      expect(popsToTop()).toEqual([]);
      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
    });

    it('does not pop when a tab press listener prevents the default', async () => {
      preventsTabPress.current = true;
      await renderTabs();
      await press('open-Accounts');

      await tapTabAgain();

      expect(popsToTop()).toEqual([]);
      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
    });

    it('listens to the tab press only, not to another tab event', async () => {
      await renderTabs();
      await press('open-Accounts');

      await act(async () => {
        pressTab?.('tabLongPress');
      });
      await elapse(50);

      expect(popsToTop()).toEqual([]);
      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
    });

    it('leaves the pop to native tabs, which pop to the root themselves', async () => {
      initialMeta.current = { type: 'native-tabs' };
      await renderTabs(ConfiguredTabStack);
      await press('open-Accounts');

      await tapTabAgain();

      expect(popsToTop()).toEqual([]);
      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
    });

    it.each([[{ type: 'bottom-tabs' }], [{}]])(
      'pops under navigation meta %j that is not native tabs',
      async (meta) => {
        initialMeta.current = meta;
        await renderTabs(ConfiguredTabStack);
        await press('open-Accounts');

        await tapTabAgain();

        expect(stackRouteNames()).toEqual(['Accounts']);
      },
    );

    it('stops listening once the meta turns native tabs', async () => {
      await renderTabs(ConfiguredTabStack);
      await press('open-Accounts');
      await act(async () => changeMeta.current?.({ type: 'native-tabs' }));

      await tapTabAgain();

      expect(popsToTop()).toEqual([]);
      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
    });

    it('starts listening once the meta stops being native tabs', async () => {
      initialMeta.current = { type: 'native-tabs' };
      await renderTabs(ConfiguredTabStack);
      await press('open-Accounts');
      await act(async () => changeMeta.current?.(undefined));

      await tapTabAgain();

      expect(stackRouteNames()).toEqual(['Accounts']);
    });

    it('cancels the pending pop when the stack goes away within the frame', async () => {
      await renderTabs(ConfiguredTabStack);
      await press('open-Accounts');

      await act(async () => {
        pressTab?.();
      });
      await act(async () => hideStack.current?.());
      await elapse(50);

      expect(popsToTop()).toEqual([]);
    });

    it('stops listening once the stack goes away', async () => {
      await renderTabs(ConfiguredTabStack);
      await press('open-Accounts');
      await act(async () => hideStack.current?.());

      await tapTabAgain();

      expect(popsToTop()).toEqual([]);
    });

    it('pops once for two taps within one frame', async () => {
      await renderTabs();
      await press('open-Accounts');

      await act(async () => {
        pressTab?.();
        pressTab?.();
      });
      await elapse(50);

      expect(popsToTop()).toHaveLength(1);
    });

    it('pops a page the user opened above a runtime default too', async () => {
      await renderTabs();
      await showDefault();
      await press('open-Detail');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail', 'Form']);

      await tapTabAgain();

      expect(stackRouteNames()).toEqual(['Accounts']);
    });
  });

  describe('leaving the tab', () => {
    it('pops to the root, and the default is there again on return', async () => {
      await renderApp();
      await press('open-Accounts');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);

      await act(async () => navigationRef.navigate('Other'));
      await act(async () => navigationRef.goBack());

      expect(stackRouteNames()).toEqual(['Accounts']);
      expect(screen.getByTestId('screen-Accounts')).toBeTruthy();
      expect(screen.getByTestId('screen-Statement')).toBeTruthy();
      expect(screen.queryByTestId('screen-Detail')).toBeNull();
    });
  });
});
