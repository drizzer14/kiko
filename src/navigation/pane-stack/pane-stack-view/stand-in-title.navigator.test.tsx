import { Pressable, ScrollView, Text } from 'react-native';
import type { LayoutMode, VerticalBarEdge } from '@kiko/display-regions';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContainer, type ParamListBase, useRoute } from '@react-navigation/native';

import '@kiko/design-system/unistyles';

import { fittingLargeTitleLayout } from '@kiko/navigation/fitting-large-title';
import LargeTitleHeading from '@kiko/design-system/components/large-title-heading';
import { largeTitleScreenOptions } from '@kiko/navigation/large-title-screen-options';

import { useOpenInPane } from '../open-in-pane';
import { useClosePaneRoute } from '../close-pane-route';
import { SETTLE_DELAY_MS } from '../use-settled-layout-mode';
import { createPaneStackNavigator } from '../create-pane-stack-navigator';

const mockWindow = {
  mode: 'columns' as LayoutMode,
  verticalBarEdge: 'trailing' as VerticalBarEdge,
  listeners: new Set<() => void>(),
};

jest.mock('@kiko/display-regions', () => {
  const { useSyncExternalStore } = require('react');

  return {
    useLayoutMode: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockWindow.listeners.add(listener);

          return () => mockWindow.listeners.delete(listener);
        },
        () => mockWindow.mode,
      ),
    useFoldRegion: () => null,
    useTabBarEdge: () => 'none',
    useVerticalBarEdge: () => mockWindow.verticalBarEdge,
  };
});

const changeWindow = async (change: Partial<typeof mockWindow>): Promise<void> => {
  await act(async () => {
    Object.assign(mockWindow, change);

    for (const listener of mockWindow.listeners) {
      listener();
    }

    jest.advanceTimersByTime(SETTLE_DELAY_MS);
  });
};

const Home = () => {
  const openInPane = useOpenInPane();

  return <Pressable testID="open" onPress={() => openInPane('Form')} />;
};

// The Statistics screen renders the heading the layout hands it, as the real one does.
const Statistics = () => (
  <ScrollView>
    <LargeTitleHeading />

    <Text>body</Text>
  </ScrollView>
);

const Form = () => {
  const closePaneRoute = useClosePaneRoute();
  const { key } = useRoute();

  return <Pressable testID="close" onPress={() => closePaneRoute(key)} />;
};

const PaneStack = createPaneStackNavigator<ParamListBase>();

// The Home stack: the list in the primary pane, Statistics standing in the companion pane.
const App = () => (
  <NavigationContainer>
    <PaneStack.Navigator
      paneConfig={{
        rootPane: 'primary',
        companionDefault: { name: 'Statistics', isDefault: true },
      }}
      screenOptions={{ headerShown: false }}
      screenLayout={fittingLargeTitleLayout}
    >
      <PaneStack.Screen name="Home" component={Home} />

      <PaneStack.Screen
        name="Statistics"
        component={Statistics}
        options={{ headerShown: true, ...largeTitleScreenOptions, title: 'Statistics' }}
      />

      <PaneStack.Screen name="Form" component={Form} />
    </PaneStack.Navigator>
  </NavigationContainer>
);

type RenderedNode = {
  type: string;
  props: Record<string, unknown>;
  children: (RenderedNode | string)[] | null;
};

const headerConfigs = (node: RenderedNode | string | null): Record<string, unknown>[] =>
  node === null || typeof node === 'string'
    ? []
    : [
        ...(node.type === 'RNSScreenStackHeaderConfig' ? [node.props] : []),
        ...(node.children ?? []).flatMap(headerConfigs),
      ];

// What the native bar of Statistics is set to: the header configs that are not hidden.
const statisticsBar = () =>
  headerConfigs(screen.toJSON() as unknown as RenderedNode)
    .filter((config) => config.hidden !== true)
    .map(({ title, largeTitle }) => ({ title, largeTitle }));

const IN_ROW = [{ title: '', largeTitle: false }];
const LARGE_TITLE = [{ title: 'Statistics', largeTitle: true }];

const headingCount = () => screen.queryAllByTestId('large-title-heading').length;

describe('Statistics standing in the left pane beside a side bar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockWindow.mode = 'columns';
    mockWindow.verticalBarEdge = 'trailing';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows its title once, in the bar row: the native large title is off', async () => {
    await render(<App />);

    expect(headingCount()).toBe(1);
    expect(statisticsBar()).toEqual(IN_ROW);
  });

  it('keeps the native large title where no side bar stands beside the pane', async () => {
    mockWindow.verticalBarEdge = 'none';

    await render(<App />);

    expect(headingCount()).toBe(0);
    expect(statisticsBar()).toEqual(LARGE_TITLE);
  });

  it('takes the in-row title again when it returns after a page opened in its pane', async () => {
    await render(<App />);
    await fireEvent.press(screen.getByTestId('open'));

    expect(headingCount()).toBe(0);

    await fireEvent.press(screen.getByTestId('close'));

    expect(headingCount()).toBe(1);
    expect(statisticsBar()).toEqual(IN_ROW);
  });

  it('starts from its own options when it returns after a page opened in its pane', async () => {
    await render(<App />);
    await fireEvent.press(screen.getByTestId('open'));
    await changeWindow({ verticalBarEdge: 'none' });
    await fireEvent.press(screen.getByTestId('close'));

    expect(headingCount()).toBe(0);
    expect(statisticsBar()).toEqual(LARGE_TITLE);
  });

  it('starts from its own options when it returns after a fold and an unfold', async () => {
    await render(<App />);
    await changeWindow({ mode: 'single' });
    await changeWindow({ verticalBarEdge: 'none' });
    await changeWindow({ mode: 'columns' });

    expect(headingCount()).toBe(0);
    expect(statisticsBar()).toEqual(LARGE_TITLE);
  });

  it('shows its title once, in the bar row, after a fold and an unfold', async () => {
    await render(<App />);
    await changeWindow({ mode: 'single' });
    await changeWindow({ mode: 'columns' });

    expect(headingCount()).toBe(1);
    expect(statisticsBar()).toEqual(IN_ROW);
  });
});
