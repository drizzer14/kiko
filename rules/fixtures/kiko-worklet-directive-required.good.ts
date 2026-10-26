import { useAnimatedStyle, withTiming } from 'react-native-reanimated';

// Semgrep fixture (NEGATIVE): five shapes `kiko-worklet-directive-required`
// must NOT flag (the fifth, a tagged helper declared after the hook call, is
// at the bottom) — a same-file helper tagged with its own `'worklet'`
// directive, a helper defined INLINE directly inside the worklet callback
// (already part of that worklet's own closure, per kiko-gestures — never
// captured remotely), and a function imported from ANOTHER module
// (`withTiming`, from `react-native-reanimated`) — this rule only checks a
// SAME-file declaration, so an imported helper is a known false negative,
// per kiko-gestures' "Every function called inside a worklet..." section —
// and an untagged same-file helper called in the hook's DEPENDENCY argument,
// which runs on the JS thread and is never part of the worklet's closure.
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

const dependencyListFor = (liftValue: number): number[] => {
  return [liftValue];
};

export const useFadeStyle = (opacity: { value: number }) =>
  useAnimatedStyle(() => ({ opacity: opacity.value }), dependencyListFor(1));

// A helper tagged with its own `'worklet'` directive but declared AFTER the
// hook call (a hoisted function declaration, then a const) is still safe: the
// rule's "not tagged" exclusions must cover a declaration on either side of
// the call, not only one declared before it.
export const useDimStyle = (dimValue: { value: number }) =>
  useAnimatedStyle(() => ({ opacity: dimForLater(dimValue.value) * dimByLater(dimValue.value) }));

function dimForLater(dimOpacityValue: number): number {
  'worklet';

  return dimOpacityValue * 0.25;
}

const dimByLater = (dimOpacityValue: number): number => {
  'worklet';

  return dimOpacityValue * 0.75;
};

// Probe:a tagged helper whose body is ONLY the directive.
const settleForRest = (): void => {
  'worklet';
};

export const useRestStyle = (restScale: { value: number }) =>
  useAnimatedStyle(() => {
    settleForRest();

    return { transform: [{ scale: restScale.value }] };
  });
