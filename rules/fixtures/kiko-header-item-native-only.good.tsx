import { type ColorValue, StyleSheet } from 'react-native';
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

// A style named for the header slot is not a header option.
export const styles = StyleSheet.create({ headerRight: { flexDirection: 'row' } });

// `undefined` clears a header item set earlier; it builds no view.
export const clearHeaderItems = (navigation: OptionsSetter): void => {
  navigation.setOptions({ headerRight: undefined, headerLeft: undefined });
};

// Reading the header options back builds no view.
export const readHeaderItems = (options: NativeStackNavigationOptions): unknown[] => {
  const { headerRight } = options;
  let { headerLeft: left } = options;
  left ??= headerRight;

  return [headerRight, left];
};
