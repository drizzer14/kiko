import type { FC } from 'react';
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import { Button, Text } from 'react-native';

// Semgrep fixture (POSITIVE): kiko-header-item-native-only. A header action is
// a native `type: 'button'` bar item; a React view in `headerRight`,
// `headerLeft`, or a `type: 'custom'` item gets a different glyph size and
// capsule than its native neighbour — see kiko-design-system's "UX patterns".

type OptionsSetter = { setOptions: (options: Partial<NativeStackNavigationOptions>) => void };

const Stack = createNativeStackNavigator();

const Home: FC = () => <Text>Home</Text>;

export const setReactHeaderRight = (navigation: OptionsSetter): void => {
  // EXPECT-FINDING
  navigation.setOptions({ headerRight: () => <Button title="Edit" onPress={() => undefined} /> });
};

const renderEditButton = () => <Button title="Edit" onPress={() => undefined} />;

export const setNamedHeaderRight = (navigation: OptionsSetter): void => {
  // EXPECT-FINDING
  navigation.setOptions({ headerRight: renderEditButton });
};

export const setShorthandHeaderRight = (navigation: OptionsSetter): void => {
  const headerRight = renderEditButton;
  // EXPECT-FINDING
  navigation.setOptions({ headerRight });
};

export const clearRightSetLeft = (navigation: OptionsSetter): void => {
  // EXPECT-FINDING
  navigation.setOptions({ headerRight: undefined, headerLeft: () => <Text>Back</Text> });
};

export const HiddenBackStack: FC = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="Home"
      component={Home}
      // EXPECT-FINDING
      options={{ headerLeft: () => null }}
    />
  </Stack.Navigator>
);

export const setCustomRightItem = (navigation: OptionsSetter): void => {
  navigation.setOptions({
    unstable_headerRightItems: () => [
      // EXPECT-FINDING
      { type: 'custom', element: <Button title="Edit" onPress={() => undefined} /> },
    ],
  });
};

export const setCustomLeftItem = (navigation: OptionsSetter): void => {
  navigation.setOptions({
    unstable_headerLeftItems: () => [
      // EXPECT-FINDING
      { type: 'custom', element: <Text>Back</Text> },
    ],
  });
};
