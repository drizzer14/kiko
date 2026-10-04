import type { ColorValue } from 'react-native';
import type { NativeStackHeaderItemButton } from '@react-navigation/native-stack';

type EditBarItemOptions = {
  label: string;
  tintColor: ColorValue;
  onPress: () => void;
};

// The Reminders bell the AccountDetail header draws beside the Edit pencil;
// one constant so the SF Symbol guard reads the symbol the screen draws.
export const REMINDERS_BELL_SYMBOL = 'bell';

// A native bar item, not a React view in a `custom` item, so UIKit sizes the
// pencil, its glass capsule, and its 44pt target exactly like the bell beside
// it. UIKit draws only the image in the bar when a bar item has both an image
// and a title, but the title still appears in the system More overflow menu
// and the Large Content Viewer, and it is the VoiceOver name, so never drop
// or empty `label`.
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
