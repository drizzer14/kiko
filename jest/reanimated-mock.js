// A minimal react-native-reanimated stub for Jest.
//
// The package's own mock (`react-native-reanimated/mock`) transitively requires
// the real reanimated index, which pulls in the native `react-native-worklets`
// binding and throws under react-test-renderer on the New Architecture
// (`loadUnpackersWithCode` has no native module). Nothing in the suite drives a
// real reanimated animation — the sortables grid is fully mocked — so app code
// touches exactly one reanimated API at test time: `useAnimatedRef`, whose
// ref the grid screens hand to `Sortable.Grid` + `Screen` for drag auto-scroll.
// This stub returns a plain ref object for it and resolves any other accessed
// member to a no-op through the Proxy, so a stray reanimated import can never
// crash a test.
const useAnimatedRef = () => ({ current: null });
const noop = () => undefined;

const base = { __esModule: true, useAnimatedRef };
const proxy = new Proxy(base, {
  get: (target, prop) => (prop in target ? target[prop] : noop),
});
base.default = proxy;

module.exports = proxy;
