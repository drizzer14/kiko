import type { ColorValue } from 'react-native';
import { editBarItem } from '@kiko/design-system/edit-bar-item';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

// Semgrep fixture (POSITIVE): kiko-no-header-spacing-item. native-stack sends a
// `type: 'spacing'` item with no index, so react-native-screens inserts it at
// the trailing edge instead of between the items it was meant to split — see
// kiko-design-system's "UX patterns".

type OptionsSetter = { setOptions: (options: Partial<NativeStackNavigationOptions>) => void };

export const setSpacedRightItems = (
  navigation: OptionsSetter,
  tintColor: ColorValue,
  onEdit: () => void,
): void => {
  navigation.setOptions({
    unstable_headerRightItems: () => [
      editBarItem({ label: 'Edit', tintColor, onPress: onEdit }),
      // EXPECT-FINDING
      { type: 'spacing', spacing: 8 },
      editBarItem({ label: 'Edit', tintColor, onPress: onEdit }),
    ],
  });
};

export const setSpacedLeftItems = (
  navigation: OptionsSetter,
  tintColor: ColorValue,
  onEdit: () => void,
): void => {
  navigation.setOptions({
    unstable_headerLeftItems: () => [
      // EXPECT-FINDING
      { type: 'spacing', spacing: 8 },
      editBarItem({ label: 'Edit', tintColor, onPress: onEdit }),
    ],
  });
};
