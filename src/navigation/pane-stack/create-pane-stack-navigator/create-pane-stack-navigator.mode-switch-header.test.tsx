import {
  NavigationContainer,
  type NavigationProp,
  type ParamListBase,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import { useLayoutEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LayoutMode } from '@kiko/display-regions';
import { headerConfigsIn } from '@kiko/test-support/header-configs';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import { useOpenInPane } from '../open-in-pane';
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

const settle = async (): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(SETTLE_DELAY_MS);
  });
};

const ENTITY_NAME = 'Monobank';

const List = () => {
  const openInPane = useOpenInPane();

  return (
    <Pressable testID="open" onPress={() => openInPane('AccountDetail', { name: ENTITY_NAME })} />
  );
};

// Sets its title and header item from a layout effect whose dependencies do not change on a
// remount, as the account detail screen does.
const Detail = () => {
  const route = useRoute();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { name } = route.params as { name: string };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
      unstable_headerRightItems: () => [
        { type: 'button', label: 'Edit', onPress: () => undefined },
      ],
    });
  }, [navigation, name]);

  return (
    <View testID="detail">
      <Text>{name}</Text>
    </View>
  );
};

const PaneStack = createPaneStackNavigator<ParamListBase>();

const App = () => (
  <NavigationContainer>
    <PaneStack.Navigator paneConfig={{ rootPane: 'companion' }}>
      <PaneStack.Screen name="Accounts" component={List} options={{ title: 'Accounts' }} />

      <PaneStack.Screen name="AccountDetail" component={Detail} />
    </PaneStack.Navigator>
  </NavigationContainer>
);

type HeaderConfig = { title: string; rightItemCount: number };

// The detail screen's header is the one titled with the entity, or with the route name it falls
// back to once its own options are lost.
const detailHeaders = (): HeaderConfig[] =>
  headerConfigsIn<{ title?: unknown; headerRightBarButtonItems?: unknown[] }>(screen.toJSON())
    .map((props) => ({
      title: String(props.title),
      rightItemCount: (props.headerRightBarButtonItems ?? []).length,
    }))
    .filter((config) => config.title === ENTITY_NAME || config.title === 'AccountDetail');

describe('a pane stack mode switch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockModeStore.mode = 'columns';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the screen own header title and item through a fold and an unfold', async () => {
    await render(<App />);
    await fireEvent.press(screen.getByTestId('open'));

    expect(detailHeaders()).toEqual([{ title: ENTITY_NAME, rightItemCount: 1 }]);

    await emitMode('single');
    await settle();

    expect(detailHeaders()).toEqual([{ title: ENTITY_NAME, rightItemCount: 1 }]);

    await emitMode('columns');
    await settle();

    expect(detailHeaders()).toEqual([{ title: ENTITY_NAME, rightItemCount: 1 }]);
  });
});
