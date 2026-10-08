import { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

// Semgrep fixture (POSITIVE): reanimated's `useAnimatedKeyboard()` is banned
// in this codebase — its native observer reaches
// `[[UIApplication sharedApplication] delegate] window]`, a legacy
// AppDelegate-owns-the-window assumption that SIGABRTs under this app's
// UIScene lifecycle (`SceneDelegate`, not `AppDelegate`, owns the `UIWindow`;
// see `kiko-gestures`'s "`useAnimatedKeyboard()` is banned" section).
// `kiko-no-use-animated-keyboard` MUST report a finding on the pinned line
// below. Never "fix" this file — drive keyboard height from RN core
// `Keyboard` events instead, as `bottom-sheet.component.tsx` does.
export const useBannedKeyboardHeightStyle = () => {
  // EXPECT-FINDING
  const keyboard = useAnimatedKeyboard();

  return useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));
};
