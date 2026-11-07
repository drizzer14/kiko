// Semgrep fixture (NEGATIVE): `kiko-no-hard-coded-native-scheme` MUST report nothing here. A
// `colorScheme` of `system`, a `keyboardAppearance` of `default`, a material with no scheme in
// its name, a scheme read from a variable, and an unrelated prop or field that merely holds the
// word are all outside the rule.
import { Text, TextInput } from 'react-native';
import { LiquidGlassView } from '@callstack/liquid-glass';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export const systemGlass = <LiquidGlassView colorScheme="system" />;

export const defaultKeyboard = <TextInput keyboardAppearance="default" />;

declare const scheme: 'dark' | 'light';

export const schemeFromVariable = (
  <LiquidGlassView colorScheme={scheme}>
    <TextInput keyboardAppearance={scheme} />
  </LiquidGlassView>
);

export const noKeyboardAppearance = <TextInput autoCorrect={false} />;

export const inputProps = {
  keyboardAppearance: 'default',
  autoCorrect: false,
};

export const followsWindow: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerBlurEffect: 'systemChromeMaterial',
};

export const noBlur: NativeStackNavigationOptions = {
  headerTransparent: true,
};

export const labelled = <Text accessibilityLabel="dark">Dark</Text>;
