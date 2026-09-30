import type { ColorValue } from 'react-native';
import type { NativeStackHeaderItemButton } from '@react-navigation/native-stack';

type EditBarItemOptions = {
  label: string;
  tintColor: ColorValue;
  onPress: () => void;
};

// A native bar item, not a React view in a `custom` item, so UIKit sizes the
// pencil, its glass capsule, and its 44pt target exactly like the bell beside
// it. UIKit draws only the image when a bar item has both an image and a
// title, so `label` stays the VoiceOver name and never shows as text.
// `sharesBackground: false` keeps it in its own capsule: two glyphs in one
// shared capsule read as one control.
export const editBarItem = ({
  label,
  tintColor,
  onPress,
}: EditBarItemOptions): NativeStackHeaderItemButton => ({
  type: 'button',
  label,
  accessibilityLabel: label,
  icon: { type: 'sfSymbol', name: 'pencil' },
  tintColor,
  sharesBackground: false,
  onPress,
});
