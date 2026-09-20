// A minimal react-native-reanimated stub for Jest.
//
// The package's own mock (`react-native-reanimated/mock`) transitively requires
// the real reanimated index, which pulls in the native `react-native-worklets`
// binding and throws under react-test-renderer on the New Architecture
// (`loadUnpackersWithCode` has no native module). Nothing in the suite drives a
// real reanimated animation, so this stub provides just enough JS-thread
// behaviour for the two APIs app code actually reaches at test time:
//
// - `useAnimatedRef` — the grid screens' drag auto-scroll ref.
// - `useScrollOffset` — the live `contentOffset.y` the large-title tab roots
//   hand to `useScrollToTopOnTabPress` so it can skip a scroll when the content
//   is already at the top. Returns the same stable `{ value }` box shape a real
//   shared value exposes on the JS thread; nothing in the suite scrolls, so it
//   stays at its initial `0`.
// - the shared-value + animated-style set the shared `BottomSheet` uses for its
//   drag-down-to-close (`useSharedValue`, `useAnimatedStyle`, `withSpring`,
//   `runOnJS`, and the animated `View`). The Pan runs `.runOnJS(true)`, so its
//   handlers are plain JS in both prod and test; here `useSharedValue` returns a
//   stable mutable box, `useAnimatedStyle` evaluates its factory once per render,
//   the animation helpers resolve to their target value, and `runOnJS` returns
//   the function unwrapped so a JS-thread callback just runs.
// - `useAnimatedKeyboard` — `BottomSheet`'s keyboard-aware lift. Returns a
//   single MODULE-SCOPED `mockKeyboardHeight` box (exported below) rather than
//   a fresh one per call, so a test can mutate `.value` directly to simulate
//   the keyboard being shown, then assert the sheet's animated style reacts —
//   the same "expose a mutable flag for a describe block to flip" pattern
//   `bottom-sheet.component.test.tsx` already uses for
//   `liquidGlass.isLiquidGlassSupported`. Defaults to `0` (no keyboard),
//   matching the real hook's real-device default; a test that mutates it must
//   reset it back to `0` afterwards so the change never leaks into another
//   test in the same file.
//
// Any other accessed member still resolves to a no-op through the Proxy, so a
// stray reanimated import can never crash a test.
const React = require('react');
const { View } = require('react-native');

const useAnimatedRef = () => ({ current: null });
const useSharedValue = (initial) => {
  const box = React.useRef(null);
  if (box.current === null) {
    box.current = { value: initial };
  }
  return box.current;
};
const useScrollOffset = () => useSharedValue(0);
const useAnimatedStyle = (factory) => factory();
const withSpring = (toValue) => toValue;
const withTiming = (toValue) => toValue;
const runOnJS = (fn) => fn;
const noop = () => undefined;

const mockKeyboardHeight = { value: 0 };
const useAnimatedKeyboard = () => ({ height: mockKeyboardHeight, state: { value: 0 } });

const base = {
  __esModule: true,
  useAnimatedRef,
  useSharedValue,
  useScrollOffset,
  useAnimatedStyle,
  useAnimatedKeyboard,
  mockKeyboardHeight,
  withSpring,
  withTiming,
  runOnJS,
  View,
};
const proxy = new Proxy(base, {
  get: (target, prop) => (prop in target ? target[prop] : noop),
});
base.default = proxy;

module.exports = proxy;
