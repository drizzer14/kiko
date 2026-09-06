import { HeaderHeightContext } from '@react-navigation/elements';
import {
  NavigationContext,
  type NavigationProp,
  NavigationRouteContext,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';
import { act, renderHook } from '@testing-library/react-native';
import { createRef, type ReactNode, type RefObject } from 'react';

import { type TabRootScrollable, useScrollToTopOnTabPress } from './use-scroll-to-top-on-tab-press';

// The hook now owns the `tabPress` subscription itself (instead of delegating to
// `@react-navigation/native`'s `useScrollToTop`) so it can scroll past a literal
// `y: 0` to the true, inset-adjusted large-title top. These tests drive a fake
// tab navigator + route through the real React Navigation contexts, fire a
// `tabPress`, and assert the header-inset scroll target (`-headerHeight`) and the
// focus/first-route gating that guards against scrolling a non-focused or pushed
// screen.

type TabPressHandler = (e: { defaultPrevented: boolean }) => void;
type FrameCallback = (time: number) => void;

const ROUTE_KEY = 'tab-root-route';

// A representative native-stack header height the tab roots render under.
// `HeaderHeightContext` reports the COLLAPSED header height, so the hook adds the
// large-title band (`52`) and scrolls to `-(headerHeight + 52)` (the fully
// expanded large-title top), which can never overshoot into the void the old
// fixed `-1000` target produced.
const MOCK_HEADER_HEIGHT = 96;
// The iOS large-title band the hook adds to the collapsed header height; kept in
// sync with `LARGE_TITLE_BAND` in the hook.
const LARGE_TITLE_BAND = 52;
// The fully expanded large-title top the hook targets: `-(96 + 52) = -148`.
const EXPANDED_TOP = -(MOCK_HEADER_HEIGHT + LARGE_TITLE_BAND);

// The hook defers its scroll one frame via `requestAnimationFrame` (so all other
// `tabPress` listeners run first). Capture those callbacks and let each test flush
// them explicitly, rather than running them synchronously inside the mock — a
// synchronous mock would re-enter React's own `act`-driven flush.
const frameCallbacks: FrameCallback[] = [];

const flushFrames = () => {
  const pending = frameCallbacks.splice(0);
  for (const cb of pending) {
    cb(0);
  }
};

type SetupOptions = {
  isFocused?: boolean;
  firstRouteKey?: string;
  // `undefined` (the default) renders WITHOUT a `HeaderHeightContext.Provider`,
  // so the hook sees the context's own default and falls back to `0` — the
  // header-hidden Home case. A number wraps the tree in a provider at that
  // height, the large-title tab-root case.
  headerHeight?: number;
};

const setup = async (ref: RefObject<TabRootScrollable | null>, options: SetupOptions = {}) => {
  const { isFocused = true, firstRouteKey = ROUTE_KEY, headerHeight } = options;

  const handlers: TabPressHandler[] = [];

  const tabNavigation = {
    getState: () => ({ type: 'tab', routes: [{ key: ROUTE_KEY }], index: 0 }),
    getParent: () => undefined,
    addListener: (event: string, cb: TabPressHandler) => {
      if (event === 'tabPress') {
        handlers.push(cb);
      }
      return () => {
        const index = handlers.indexOf(cb);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      };
    },
  } as unknown as NavigationProp<ParamListBase>;

  const screenNavigation = {
    isFocused: () => isFocused,
    getState: () => ({ type: 'stack', routes: [{ key: firstRouteKey }], index: 0 }),
    getParent: () => tabNavigation,
  } as unknown as NavigationProp<ParamListBase>;

  const route = { key: ROUTE_KEY, name: 'TabRoot' } as unknown as RouteProp<ParamListBase>;

  const wrapper = ({ children }: { children: ReactNode }) => {
    const withContexts = (
      <NavigationContext.Provider value={screenNavigation}>
        <NavigationRouteContext.Provider value={route}>{children}</NavigationRouteContext.Provider>
      </NavigationContext.Provider>
    );

    // A number wraps in a `HeaderHeightContext.Provider` (the large-title tab
    // roots); `undefined` renders without one so the hook falls back to `0`.
    return headerHeight === undefined ? (
      withContexts
    ) : (
      <HeaderHeightContext.Provider value={headerHeight}>
        {withContexts}
      </HeaderHeightContext.Provider>
    );
  };

  await act(async () => {
    renderHook(() => useScrollToTopOnTabPress(ref), { wrapper });
  });

  const fireTabPress = (defaultPrevented = false) => {
    // Drop any frame callbacks queued during mount so we flush only the hook's
    // own deferred scroll below.
    frameCallbacks.length = 0;
    for (const handler of handlers) {
      handler({ defaultPrevented });
    }
    flushFrames();
  };

  return { fireTabPress, handlerCount: () => handlers.length };
};

describe('useScrollToTopOnTabPress', () => {
  beforeEach(() => {
    frameCallbacks.length = 0;
    // Queue the hook's deferred scroll instead of firing it, so `fireTabPress`
    // can flush it deterministically without re-entering React's `act` flush.
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      frameCallbacks.push(cb);
      return frameCallbacks.length;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('subscribes to the parent tab navigator on mount', async () => {
    const scrollRef = createRef<TabRootScrollable>();

    const { handlerCount } = await setup(scrollRef);

    expect(handlerCount()).toBe(1);
  });

  it('scrolls a ScrollView to the header inset (the true top) on active-tab re-tap', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress } = await setup(scrollRef, { headerHeight: MOCK_HEADER_HEIGHT });
    fireTabPress();

    // Target is `-(headerHeight + LARGE_TITLE_BAND)`: the fully expanded
    // large-title top. `HeaderHeightContext` reports the COLLAPSED header
    // height, so the band is added to reach the expanded top. iOS does not clamp
    // an animated programmatic scroll, and the `Screen` ScrollView's
    // `scrollToOverflowEnabled` disables RN's clamp, so this bounded target
    // lands at the expanded large-title top and can never overshoot into a void
    // (the old fixed `-1000` did).
    expect(scrollTo).toHaveBeenCalledWith({ y: EXPANDED_TOP, animated: true });
  });

  it('scrolls a FlatList/SectionList to the header inset via scrollToOffset', async () => {
    const scrollToOffset = jest.fn();
    const scrollRef = { current: { scrollToOffset } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress } = await setup(scrollRef, { headerHeight: MOCK_HEADER_HEIGHT });
    fireTabPress();

    expect(scrollToOffset).toHaveBeenCalledWith({ offset: EXPANDED_TOP, animated: true });
  });

  it('targets y: 0 when there is no header context (the header-hidden Home case)', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    // No `headerHeight` option -> no `HeaderHeightContext.Provider` -> the hook
    // falls back to `0`. With no header the large-title band is NOT added (the
    // `headerHeight === 0 → 0` branch), so the target stays `0`. Home's
    // `SectionList` is not the overflow-enabled ScrollView, so RN still clamps
    // this `0` target to the top — Home is unaffected by the fix.
    const { fireTabPress } = await setup(scrollRef);
    fireTabPress();

    // The no-header branch targets `0` exactly (`-0` here); `toHaveBeenCalledWith`
    // uses `Object.is`, so assert the exact `-0` the hook passes.
    expect(scrollTo).toHaveBeenCalledWith({ y: -0, animated: true });
  });

  it('does not scroll when the screen is not focused', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress } = await setup(scrollRef, { isFocused: false });
    fireTabPress();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll when the screen is not the first route of its stack (a pushed detail)', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress } = await setup(scrollRef, { firstRouteKey: 'some-other-first-route' });
    fireTabPress();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll when another tabPress listener called preventDefault', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress } = await setup(scrollRef);
    fireTabPress(true);

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
