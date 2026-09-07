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

const base = {
  __esModule: true,
  useAnimatedRef,
  useSharedValue,
  useScrollOffset,
  useAnimatedStyle,
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
