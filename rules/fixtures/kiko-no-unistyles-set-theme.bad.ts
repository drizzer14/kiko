// Semgrep fixture (POSITIVE): kiko-design-system's "Native chrome follows the window" makes the
// window's interface style the only theme switch (Unistyles' `adaptiveThemes` setting).
// `kiko-no-unistyles-set-theme` MUST report a finding on each pinned line: a `setTheme` call
// and a `setAdaptiveThemes` call, with a literal argument and with a computed one.
import { UnistylesRuntime } from 'react-native-unistyles';

// EXPECT-FINDING
UnistylesRuntime.setTheme('dark');

// EXPECT-FINDING
UnistylesRuntime.setAdaptiveThemes(false);

export const applyScheme = (isLight: boolean): void => {
  // EXPECT-FINDING
  UnistylesRuntime.setTheme(isLight ? 'light' : 'dark');
};

export const stopFollowingWindow = (): void => {
  // EXPECT-FINDING
  UnistylesRuntime.setAdaptiveThemes(!UnistylesRuntime.hasAdaptiveThemes);
};
