import type { ColorValue } from 'react-native';
import { editBarItem } from '@kiko/design-system/edit-bar-item';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

// Semgrep fixture (NEGATIVE): items split by `sharesBackground: false`, each in
// its own capsule, with no spacing item between them. A `type: 'spacing'`
// object outside any header option is not a header item.

type OptionsSetter = { setOptions: (options: Partial<NativeStackNavigationOptions>) => void };

type Handlers = { openReminders: () => void; openEdit: () => void };

export const setSplitItems = (
  navigation: OptionsSetter,
  tintColor: ColorValue,
  handlers: Handlers,
): void => {
  navigation.setOptions({
    unstable_headerRightItems: () => [
      {
        type: 'button',
        label: 'Reminders',
        accessibilityLabel: 'Reminders',
        icon: { type: 'sfSymbol', name: 'bell' },
        tintColor,
        sharesBackground: false,
        onPress: handlers.openReminders,
      },
      editBarItem({ label: 'Edit', tintColor, onPress: handlers.openEdit }),
    ],
  });
};

export const gridGap = { type: 'spacing', spacing: 8 };
