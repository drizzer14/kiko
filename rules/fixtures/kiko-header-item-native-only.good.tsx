import type { ColorValue } from 'react-native';
import { editBarItem } from '@kiko/design-system/edit-bar-item';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

// Semgrep fixture (NEGATIVE): the account-detail header shape. The bell is a
// native `type: 'button'` item and Edit is `editBarItem(...)`, so UIKit sizes
// both glyphs and capsules alike. A `type: 'custom'` object outside any header
// option is not a header item.

type OptionsSetter = { setOptions: (options: Partial<NativeStackNavigationOptions>) => void };

type Handlers = { openReminders: () => void; openEdit: () => void };

export const setNativeHeaderItems = (
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

export const customRowKind = { type: 'custom', label: 'Custom range' };
