/**
 * Builds a `react-native-reanimated` mock module that overrides ONLY
 * `useAnimatedRef`, so the animated ref a `Screen`'s ScrollView receives
 * exposes the given spy-able `scrollToEnd` (the shared stub returns
 * `{ current: null }`, which the optional chain would swallow). Everything
 * else delegates to the shared reanimated stub (`jest/reanimated-mock`), so
 * the rest of its surface — the shared values / animated style / animated
 * `View` a transitively-imported `BottomSheet` uses, and the
 * `createAnimatedComponent` gesture-handler's detector reads at import — stays
 * intact.
 *
 * Call this INSIDE the test file's own
 * `jest.mock('react-native-reanimated', () => mockReanimatedScrollToEnd(() => mockScrollToEnd))`
 * — `jest.mock` itself must stay a literal call in the test file for Jest's
 * hoisting to see it; this helper only factors out the shared factory body
 * that three screen tests used to copy-paste verbatim.
 *
 * `getScrollToEnd` MUST stay a thunk, not the mock passed by value: the
 * factory above runs at `jest.mock` registration time, which is BEFORE the
 * test file's own `const mockScrollToEnd = jest.fn();` has executed (that
 * `const` sits below the transitive `import` chain that first pulls in
 * `react-native-reanimated`). Passing `mockScrollToEnd` directly would
 * capture `undefined` once, permanently. A thunk defers the read until
 * `useAnimatedRef()` actually runs at render time, by which point the real
 * `jest.fn()` is assigned — same lazy-closure timing the original
 * copy-pasted inline factory relied on.
 *
 * Both this export's name and the `mockScrollToEnd` identifier the test
 * file's thunk closes over must stay `mock`-prefixed so Jest's
 * hoist-safety check allows the out-of-scope reference.
 */
export const mockReanimatedScrollToEnd = (getScrollToEnd: () => jest.Mock) => {
  const stub = require('../../jest/reanimated-mock');

  return new Proxy(stub, {
    get: (target, prop) =>
      prop === 'useAnimatedRef'
        ? () => Object.assign(() => undefined, { current: { scrollToEnd: getScrollToEnd() } })
        : target[prop],
  });
};
