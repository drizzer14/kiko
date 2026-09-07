/**
 * The navigation methods the screen tests actually assert on, each a Jest mock
 * so a test can read `navigation.navigate.mock.calls` back.
 *
 * WHY THIS EXISTS: a screen's `navigation` prop type has ~30 members, so every
 * test used to build a 2-key object and cast it `as never` — which made each
 * later `navigation.setOptions` read a property access on `never` (TS2339,
 * ~49 errors) while giving the test no type safety at all. This module is the
 * ONE place that cast lives, narrowed to `as unknown as` at a single
 * documented boundary, instead of scattered across twelve files.
 */
export type NavigationSpy = {
  navigate: jest.Mock;
  setOptions: jest.Mock;
  goBack: jest.Mock;
  push: jest.Mock;
  addListener: jest.Mock;
  isFocused: jest.Mock;
  getParent: jest.Mock;
  getState: jest.Mock;
};

export const navigationSpy = (): NavigationSpy => ({
  navigate: jest.fn(),
  setOptions: jest.fn(),
  goBack: jest.fn(),
  push: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  isFocused: jest.fn(() => true),
  getParent: jest.fn(() => undefined),
  getState: jest.fn(() => ({ type: 'stack', routes: [], index: 0 })),
});

/**
 * Present a `NavigationSpy` as a screen's real `navigation` prop. The cast is
 * unavoidable — a full React Navigation prop object cannot be constructed in a
 * unit test — but it is confined to this one function, and the SPY keeps its
 * own precise type at every call site so `.mock.calls` assertions stay typed.
 */
export const asNavigationProp = <TProp>(spy: NavigationSpy): TProp => spy as unknown as TProp;

/** The matching `route` prop: a name plus params, cast at the same single boundary. */
export const asRouteProp = <TProp>(name: string, params?: object): TProp =>
  ({ key: `${name}-test`, name, params }) as unknown as TProp;
