import {
  createNavigationContainerRef,
  NavigationContainer,
  type NavigationProp,
  type ParamListBase,
  useNavigation,
} from '@react-navigation/native';
import { Pressable, Text, View } from 'react-native';
import type { LayoutMode } from '@kiko/display-regions';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import { useOpenInPane } from '../open-in-pane';
import type { PaneConfig } from '../pane-assignment';
import { useDetailPaneRoute } from '../pane-visibility';
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

// The list's row marks the page the detail pane starts with, as the Settings menu does.
const MenuScreen = () => {
  const selected = useDetailPaneRoute();

  return <Text testID="selected">{selected?.name ?? 'none'}</Text>;
};

// A page that opens a form beside it: the default page does this through its stand-in.
const PageScreen = () => {
  const openInPane = useOpenInPane();

  return <Pressable testID="open-form" onPress={() => openInPane('Form')} />;
};

const FormScreen = () => {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  return (
    <View testID="form">
      <Pressable testID="go-back" onPress={() => navigation.goBack()} />
    </View>
  );
};

const navigationRef = createNavigationContainerRef<ParamListBase>();

const stackRouteNames = (): string[] =>
  (navigationRef.getRootState()?.routes ?? []).map((route) => route.name);

const settingsLike: PaneConfig = {
  rootPane: 'companion',
  primaryDefault: { name: 'Page', isDefault: true },
};

const homeLike: PaneConfig = {
  rootPane: 'primary',
  companionDefault: { name: 'Page', isDefault: true },
};

const SettingsLikeStack = createPaneStackNavigator<ParamListBase>();
const HomeLikeStack = createPaneStackNavigator<ParamListBase>();

const renderStack = async (
  Stack: ReturnType<typeof createPaneStackNavigator<ParamListBase>>,
  paneConfig: PaneConfig,
) => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator paneConfig={paneConfig} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Menu" component={MenuScreen} />

        <Stack.Screen name="Page" component={PageScreen} />

        <Stack.Screen name="Form" component={FormScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
};

describe('a form opened from the static default of a pane', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockModeStore.mode = 'columns';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sits above the default page as a real route, so the form has a page to go back to', async () => {
    await renderStack(SettingsLikeStack, settingsLike);

    await fireEvent.press(screen.getByTestId('open-form'));

    expect(stackRouteNames()).toEqual(['Menu', 'Page', 'Form']);
  });

  it('keeps the page the default stood for selected in the list while the form is open', async () => {
    await renderStack(SettingsLikeStack, settingsLike);

    await fireEvent.press(screen.getByTestId('open-form'));

    expect(screen.getByTestId('selected').children).toEqual(['Page']);
  });

  it('goes back from the form to the page, which stays selected', async () => {
    await renderStack(SettingsLikeStack, settingsLike);

    await fireEvent.press(screen.getByTestId('open-form'));
    await fireEvent.press(screen.getByTestId('go-back'));

    expect(stackRouteNames()).toEqual(['Menu', 'Page']);
    expect(screen.getByTestId('selected').children).toEqual(['Page']);
  });

  it('folds to the menu, the page and the form', async () => {
    await renderStack(SettingsLikeStack, settingsLike);

    await fireEvent.press(screen.getByTestId('open-form'));
    await emitMode('single');
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_DELAY_MS);
    });

    expect(stackRouteNames()).toEqual(['Menu', 'Page', 'Form']);
  });

  it('holds for the default of the companion pane too, whose root is in the primary pane', async () => {
    await renderStack(HomeLikeStack, homeLike);

    await fireEvent.press(screen.getByTestId('open-form'));

    expect(stackRouteNames()).toEqual(['Menu', 'Page', 'Form']);
  });
});
