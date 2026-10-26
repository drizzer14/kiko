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

// Semgrep fixture (POSITIVE) continuation: a helper declared inside a
// COMPONENT-BODY arrow (not the worklet-hook callback's own block) still
// reaches the worklet's closure untagged — the same real bug, one arrow
// level further out. `kiko-worklet-directive-required` MUST report a
// finding on the pinned line below too.
export const useLiftSheetStyle = (liftScale: { value: number }) => {
  const clampForLift = (liftScaleValue: number): number => {
    return liftScaleValue * 2;
  };

  return useAnimatedStyle(() => {
    // EXPECT-FINDING
    return { transform: [{ scale: clampForLift(liftScale.value) }] };
  });
};

// Semgrep fixture (POSITIVE) continuation: the untagged helper is declared
// AFTER the hook call, not before it — a hoisted function declaration, then a
// const (both still reach the worklet's closure untagged). The rule matches a
// declaration on either side of the call, so
// `kiko-worklet-directive-required` MUST report a finding on each pinned line
// below.
export const useDropStyle = (dropScale: { value: number }) =>
  useAnimatedStyle(() => {
    // EXPECT-FINDING
    return { transform: [{ scale: shrinkForDrop(dropScale.value) }] };
  });

function shrinkForDrop(dropScaleValue: number): number {
  return dropScaleValue / 2;
}

export const useRiseStyle = (riseScale: { value: number }) =>
  useAnimatedStyle(() => {
    // EXPECT-FINDING
    return { transform: [{ scale: growForRise(riseScale.value) }] };
  });

const growForRise = (riseScaleValue: number): number => {
  return riseScaleValue * 3;
};

// Probe:an untagged helper with an EMPTY body, and one with an EXPRESSION body, each
// called from a worklet callback. The rule must report each call line.
const settleForFall = (): void => {};

const flipForFall = (fallScaleValue: number): number => -fallScaleValue;

export const useFallStyle = (fallScale: { value: number }) =>
  useAnimatedStyle(() => {
    // EXPECT-FINDING
    settleForFall();
    // EXPECT-FINDING
    return { transform: [{ scale: flipForFall(fallScale.value) }] };
  });
