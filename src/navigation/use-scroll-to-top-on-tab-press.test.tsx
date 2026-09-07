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
import { Dimensions } from 'react-native';

import { type TabRootScrollable, useScrollToTopOnTabPress } from './use-scroll-to-top-on-tab-press';

// The hook now owns the `tabPress` subscription itself (instead of delegating to
// `@react-navigation/native`'s `useScrollToTop`) so it can scroll past a literal
// `y: 0` to the true, inset-adjusted large-title top. These tests drive a fake
// tab navigator + route through the real React Navigation contexts, fire a
// `tabPress`, and assert both the scroll target (the EXPANDED header height the
// device itself reported) and the focus/first-route gating that guards against
// scrolling a non-focused or pushed screen.

type TabPressHandler = (e: { defaultPrevented: boolean }) => void;
type FrameCallback = (time: number) => void;

const ROUTE_KEY = 'tab-root-route';

// `HeaderHeightContext` reports the LIVE, currently-animating header height of a
// native-stack screen — NOT a collapsed baseline. On a large-title tab root it is
// the expanded height while the screen sits at the top, and the collapsed one
// once the large title has scrolled away; native re-emits it on every layout
// pass. The hook therefore targets the MAXIMUM height it has seen since mount
// (the expanded one, observed within the first frames because a tab root mounts
// at the top) rather than a live value plus a guessed band. These two constants
// are the two ends of that live range for one representative device.
const MOCK_EXPANDED_HEADER_HEIGHT = 148;
const MOCK_COLLAPSED_HEADER_HEIGHT = 96;

// A landscape frame's shorter header, for the rotation case: the tracked
// portrait maximum must be discarded on a frame-size change, or a landscape tap
// would scroll past the top by the portrait/landscape difference.
const MOCK_LANDSCAPE_HEADER_HEIGHT = 64;

const PORTRAIT_FRAME = { width: 393, height: 852, scale: 3, fontScale: 1 };
const LANDSCAPE_FRAME = { width: 852, height: 393, scale: 3, fontScale: 1 };

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
  // The live `contentOffset.y` the caller passes in (reanimated's
  // `useScrollOffset` in the app). A plain `{ value }` box is exactly the read
  // surface a `SharedValue` exposes on the JS thread, so no reanimated mock is
  // needed here.
  scrollOffset?: { value: number };
};

const setup = async (ref: RefObject<TabRootScrollable | null>, options: SetupOptions = {}) => {
  const { isFocused = true, firstRouteKey = ROUTE_KEY, headerHeight, scrollOffset } = options;

  // The provider's live value, re-read on every render, so a test can drive the
  // header height the way native does: expanded at the top, collapsed once
  // scrolled down.
  let liveHeaderHeight = headerHeight;

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
    return liveHeaderHeight === undefined ? (
      withContexts
    ) : (
      <HeaderHeightContext.Provider value={liveHeaderHeight}>
        {withContexts}
      </HeaderHeightContext.Provider>
    );
  };

  // `renderHook` (and the `rerender` it returns) are async in RNTL 14, so both
  // are awaited inside `act`.
  let rerenderHook: (props: unknown) => Promise<void> = async () => undefined;

  await act(async () => {
    const { rerender } = await renderHook(() => useScrollToTopOnTabPress(ref, scrollOffset), {
      wrapper,
    });
    rerenderHook = rerender;
  });

  // Re-emit the header height, as the native `onHeaderHeightChange` event does
  // whenever the large title expands or collapses.
  const emitHeaderHeight = async (next: number) => {
    liveHeaderHeight = next;
    await act(async () => {
      await rerenderHook(undefined);
    });
  };

  const fireTabPress = (defaultPrevented = false) => {
    // Drop any frame callbacks queued during mount so we flush only the hook's
    // own deferred scroll below.
    frameCallbacks.length = 0;
    for (const handler of handlers) {
      handler({ defaultPrevented });
    }
    flushFrames();
  };

  return { fireTabPress, emitHeaderHeight, handlerCount: () => handlers.length };
};

// Rotate the device: `Dimensions.set` emits the `change` event
// `useWindowDimensions` subscribes to, which is how the hook learns the window
// frame changed.
const setWindowFrame = async (frame: typeof PORTRAIT_FRAME) => {
  await act(async () => {
    Dimensions.set({ window: frame, screen: frame });
  });
};

describe('useScrollToTopOnTabPress', () => {
  beforeEach(async () => {
    frameCallbacks.length = 0;
    await setWindowFrame(PORTRAIT_FRAME);
    // Queue the hook's deferred scroll instead of firing it, so `fireTabPress`
    // can flush it deterministically without re-entering React's `act` flush.
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
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

  it('scrolls a ScrollView to the expanded large-title top on active-tab re-tap', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress } = await setup(scrollRef, { headerHeight: MOCK_EXPANDED_HEADER_HEIGHT });
    fireTabPress();

    // The target is the expanded header height the device reported, negated. iOS
    // does not clamp an animated programmatic scroll, and the `Screen`
    // ScrollView's `scrollToOverflowEnabled` disables RN's clamp, so this target
    // reaches UIKit verbatim: it must land exactly at the expanded large-title
    // top, never past it (a void) and never short of it (a hidden large title).
    expect(scrollTo).toHaveBeenCalledWith({ y: -MOCK_EXPANDED_HEADER_HEIGHT, animated: true });
  });

  it('scrolls a FlatList/SectionList to the expanded large-title top via scrollToOffset', async () => {
    const scrollToOffset = jest.fn();
    const scrollRef = { current: { scrollToOffset } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress } = await setup(scrollRef, { headerHeight: MOCK_EXPANDED_HEADER_HEIGHT });
    fireTabPress();

    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: -MOCK_EXPANDED_HEADER_HEIGHT,
      animated: true,
    });
  });

  it('resolves two consecutive re-taps to the same absolute offset', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    // The screen mounts at the top, so the first height native reports is the
    // expanded one; scrolling down then collapses the large title and native
    // re-emits the collapsed height.
    const { fireTabPress, emitHeaderHeight } = await setup(scrollRef, {
      headerHeight: MOCK_EXPANDED_HEADER_HEIGHT,
    });
    await emitHeaderHeight(MOCK_COLLAPSED_HEADER_HEIGHT);

    fireTabPress();

    expect(scrollTo).toHaveBeenLastCalledWith({ y: -MOCK_EXPANDED_HEADER_HEIGHT, animated: true });

    // The scroll lands at the top, so the large title re-expands and native
    // re-emits the EXPANDED height. A second tap must resolve to the SAME
    // absolute offset — the old `headerHeight + 52` band counted the large title
    // twice here and parked the content 52pt past the top, in a void.
    await emitHeaderHeight(MOCK_EXPANDED_HEADER_HEIGHT);

    fireTabPress();

    expect(scrollTo).toHaveBeenLastCalledWith({ y: -MOCK_EXPANDED_HEADER_HEIGHT, animated: true });
  });

  it('discards the tracked expanded height when the window frame changes', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress, emitHeaderHeight } = await setup(scrollRef, {
      headerHeight: MOCK_EXPANDED_HEADER_HEIGHT,
    });

    // Rotating (iPad supports every orientation) re-lays out the header shorter,
    // so native reports a smaller height. Keeping the portrait maximum would
    // scroll past the landscape top by the difference.
    await setWindowFrame(LANDSCAPE_FRAME);
    await emitHeaderHeight(MOCK_LANDSCAPE_HEADER_HEIGHT);

    fireTabPress();

    expect(scrollTo).toHaveBeenLastCalledWith({ y: -MOCK_LANDSCAPE_HEADER_HEIGHT, animated: true });
  });

  it('does not re-latch the stale pre-rotation height on an interleaved re-render', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress, emitHeaderHeight } = await setup(scrollRef, {
      headerHeight: MOCK_EXPANDED_HEADER_HEIGHT,
    });

    await setWindowFrame(LANDSCAPE_FRAME);

    // native-stack only re-emits the header height through a 100ms debounce, so
    // for a moment after the rotation the context still carries the PORTRAIT
    // height. Anything else can re-render in that window (a live-query tick, the
    // frame change propagating) — and such a render must not re-latch the stale
    // portrait height as the maximum, or every landscape tap overshoots the top.
    await emitHeaderHeight(MOCK_EXPANDED_HEADER_HEIGHT);

    // Only the post-rotation native emit re-establishes the maximum.
    await emitHeaderHeight(MOCK_LANDSCAPE_HEADER_HEIGHT);

    fireTabPress();

    expect(scrollTo).toHaveBeenLastCalledWith({ y: -MOCK_LANDSCAPE_HEADER_HEIGHT, animated: true });
  });

  it('targets y: 0 when there is no header context (the header-hidden Home case)', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    // No `headerHeight` option -> no `HeaderHeightContext.Provider` -> the hook
    // falls back to `0`, so the tracked maximum stays `0` and the target is `0`.
    // Home's `SectionList` is not the overflow-enabled ScrollView, so RN still
    // clamps this `0` target to the top — Home is unaffected by the fix.
    const { fireTabPress } = await setup(scrollRef);
    fireTabPress();

    // The no-header branch targets `0` exactly (`-0` here); `toHaveBeenCalledWith`
    // uses `Object.is`, so assert the exact `-0` the hook passes.
    expect(scrollTo).toHaveBeenCalledWith({ y: -0, animated: true });
  });

  it('does not scroll when the live offset is already at the target', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    // Already at the fully expanded top: there is nothing to scroll to, and a
    // scroll from here could only move the content away from the top.
    const { fireTabPress } = await setup(scrollRef, {
      headerHeight: MOCK_EXPANDED_HEADER_HEIGHT,
      scrollOffset: { value: -MOCK_EXPANDED_HEADER_HEIGHT },
    });
    fireTabPress();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll when the live offset is above the target', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress } = await setup(scrollRef, {
      headerHeight: MOCK_EXPANDED_HEADER_HEIGHT,
      scrollOffset: { value: -200 },
    });
    fireTabPress();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('still scrolls when the live offset is below the target', async () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } } as RefObject<TabRootScrollable | null>;

    const { fireTabPress } = await setup(scrollRef, {
      headerHeight: MOCK_EXPANDED_HEADER_HEIGHT,
      scrollOffset: { value: 500 },
    });
    fireTabPress();

    expect(scrollTo).toHaveBeenLastCalledWith({ y: -MOCK_EXPANDED_HEADER_HEIGHT, animated: true });
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
