import { useEffect } from 'react';
import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
  useRoute,
} from '@react-navigation/native';
import { Pressable, Text, View } from 'react-native';
import type { LayoutMode } from '@kiko/display-regions';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { resetTabStackOnBlur } from '@kiko/navigation/reset-tab-stack-on-blur';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import { useOpenInPane } from '../open-in-pane';
import type { PaneConfig } from '../pane-assignment';
import { useIsScreenVisible } from '../pane-visibility';
import { SETTLE_DELAY_MS } from '../use-settled-layout-mode';

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

// How many times each screen mounted: a transient frame must not remount anything.
const mounts: Record<string, number | undefined> = {};

// A screen that shows whether it is visible, and a button that opens `params.opens` in the
// opposite pane.
const StubScreen = () => {
  const route = useRoute();
  const isVisible = useIsScreenVisible();
  const openInPane = useOpenInPane();
  const { opens } = (route.params ?? {}) as StubParams;

  useEffect(() => {
    mounts[route.name] = (mounts[route.name] ?? 0) + 1;
  }, [route.name]);

  return (
    <View testID={`screen-${route.name}`}>
      <Text testID={`visible-${route.name}`}>{String(isVisible)}</Text>

      {opens !== undefined && (
        <Pressable testID={`open-${route.name}`} onPress={() => openInPane(opens)} />
      )}
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

const renderApp = async () => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <ParentStack.Navigator screenOptions={{ headerShown: false }}>
        <ParentStack.Screen name="Tab" component={TabStack} />

        <ParentStack.Screen name="Other" component={StubScreen} />
      </ParentStack.Navigator>
    </NavigationContainer>,
  );
  navigationRef.addListener('__unsafe_action__', ({ data }) => {
    dispatched.push(data.action.type);
  });
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

    it('keeps the screen beside the focused one visible, and not the one it covers', async () => {
      await renderApp();

      await press('open-Accounts');
      await press('open-Detail');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail', 'Form']);
      expect(screen.getByTestId('visible-Detail').children).toEqual(['true']);
      expect(screen.getByTestId('visible-Form').children).toEqual(['true']);
      expect(screen.queryByTestId('screen-Accounts')).toBeNull();
    });

    it('opens the second row in place of the first instead of beneath it', async () => {
      await renderApp();

      await press('open-Accounts');
      await press('open-Accounts');

      expect(stackRouteNames()).toEqual(['Accounts', 'Detail']);
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

  describe('folding and unfolding', () => {
    it('folds once when the window settles on one pane, and unfolds once when it returns', async () => {
      await renderApp();
      await press('open-Accounts');

      await emitMode('single');
      await elapse(SETTLE_DELAY_MS);

      expect(paneActions()).toEqual(['PANE_OPEN', 'PANE_FOLD']);
      expect(screen.getByTestId('screen-Detail')).toBeTruthy();
      expect(screen.queryByTestId('screen-Accounts')).toBeNull();

      await emitMode('columns');
      await elapse(SETTLE_DELAY_MS);

      expect(paneActions()).toEqual(['PANE_OPEN', 'PANE_FOLD', 'PANE_UNFOLD']);
      expect(screen.getByTestId('screen-Accounts')).toBeTruthy();
      expect(screen.getByTestId('screen-Detail')).toBeTruthy();
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
