import { useAnimatedStyle } from 'react-native-reanimated';

// Semgrep fixture (POSITIVE): kiko-gestures' "Every function called inside a
// worklet needs its own 'worklet' directive" — a plain, same-file helper
// with no `'worklet'` tag, called synchronously from a worklet-hook
// callback, is captured as a "remote function" by the worklets runtime:
// invisible to `tsc` and Jest (the worklet runtime is mocked there), and
// only SIGABRTs on first render in a RELEASE build (builds 15/16 shipped
// exactly this bug). `kiko-worklet-directive-required` MUST report a
// finding on the pinned line below. Never "fix" this file by deleting the
// call — tag `scaleForLift` with its own `'worklet';` directive instead.
const scaleForLift = (liftScaleValue: number): number => {
  return liftScaleValue * 2;
};

export const useLiftStyle = (liftScale: { value: number }) =>
  useAnimatedStyle(() => {
    // EXPECT-FINDING
    return { transform: [{ scale: scaleForLift(liftScale.value) }] };
  });
