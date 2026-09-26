import { useAnimatedStyle, withTiming } from 'react-native-reanimated';

// Semgrep fixture (NEGATIVE): three shapes `kiko-worklet-directive-required`
// must NOT flag — a same-file helper tagged with its own `'worklet'`
// directive, a helper defined INLINE directly inside the worklet callback
// (already part of that worklet's own closure, per kiko-gestures — never
// captured remotely), and a function imported from ANOTHER module
// (`withTiming`, from `react-native-reanimated`) — this rule only checks a
// SAME-file declaration, so an imported helper is a known false negative,
// per kiko-gestures' "Every function called inside a worklet..." section.
const scaleForFade = (opacityValue: number): number => {
  'worklet';

  return opacityValue * 0.5;
};

export const useLiftStyle = (liftScale: { value: number }, opacity: { value: number }) =>
  useAnimatedStyle(() => {
    const scaleForBounce = (boundValue: number): number => {
      return boundValue + 1;
    };

    return {
      transform: [{ scale: scaleForFade(liftScale.value) * scaleForBounce(liftScale.value) }],
      opacity: withTiming(opacity.value, { duration: 200 }),
    };
  });
