// Semgrep fixture (POSITIVE): kiko-design-system's "Native chrome follows the window" lets the
// window's trait decide the native scheme. `kiko-no-hard-coded-native-scheme` MUST report a
// finding on each pinned line: a `colorScheme` prop, a `keyboardAppearance` prop and object
// field, and a `headerBlurEffect` prop and object field whose value names a scheme, in both
// quote styles and both attribute forms.
import { TextInput } from 'react-native';
import { LiquidGlassView } from '@callstack/liquid-glass';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

const Header = (_props: { headerBlurEffect: string }) => {
  return null;
};

// EXPECT-FINDING
export const darkGlass = <LiquidGlassView colorScheme="dark" />;

// EXPECT-FINDING
export const lightGlass = <LiquidGlassView colorScheme={'light'} />;

// EXPECT-FINDING
export const darkKeyboard = <TextInput keyboardAppearance="dark" />;

// EXPECT-FINDING
export const lightKeyboard = <TextInput keyboardAppearance={'light'} />;

// EXPECT-FINDING
export const darkHeader = <Header headerBlurEffect="systemChromeMaterialDark" />;

export const inputProps = {
  // EXPECT-FINDING
  keyboardAppearance: 'dark',
  nested: {
    // EXPECT-FINDING
    keyboardAppearance: "light",
    autoCorrect: false,
  },
};

export const darkMaterial: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  // EXPECT-FINDING
  headerBlurEffect: 'systemChromeMaterialDark',
};

export const lightMaterial: NativeStackNavigationOptions = {
  // EXPECT-FINDING
  headerBlurEffect: 'systemMaterialLight',
  headerLargeTitle: true,
};

export const plainDark: NativeStackNavigationOptions = {
  // EXPECT-FINDING
  headerBlurEffect: 'dark',
};
