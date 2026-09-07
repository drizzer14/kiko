import { HeaderHeightContext } from '@react-navigation/elements';
import {
  type EventArg,
  NavigationContext,
  type NavigationProp,
  type ParamListBase,
  useRoute,
} from '@react-navigation/native';
import { type RefObject, useContext, useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';

type ScrollOptions = { x?: number; y?: number; animated?: boolean };

// The scroll capabilities React Navigation's `useScrollToTop` recognizes on a
// raw scrollable node: a `ScrollView` (`scrollTo`), a `FlatList`
// (`scrollToOffset`), or one of the older responder-based surfaces.
type ScrollableView =
  | { scrollToTop(): void }
  | { scrollTo(options: ScrollOptions): void }
  | { scrollToOffset(options: { offset: number; animated?: boolean }): void }
  | { scrollResponderScrollTo(options: ScrollOptions): void };

/**
 * A tab-root screen's primary scrollable, the surface an active-tab re-tap
 * returns to the top: the Home transactions `SectionList`, or the `ScrollView`
 * behind the `Screen` primitive's `scroll` mode (Statistics / Accounts /
 * Settings). A `FlatList` fits too, so a future list-backed tab root works
 * unchanged.
 *
 * This names the scroll CAPABILITY rather than the three nominal RN component
 * types, exactly as React Navigation types `useScrollToTop`'s own ref
 * (`getScrollResponder(): React.ReactNode | ScrollableView`). Two reasons:
 *
 * 1. `getScrollableNode` below only ever reads these methods off `ref.current`,
 *    so the capability IS the real requirement — the nominal union had to be
 *    cast through `unknown` to be read at all.
 * 2. RN 0.87's codegen split each component's type from its instance type, and
 *    its `SectionListInstance` alias pins the section type to the library's own
 *    `DefaultSectionT`. Home's list is inferred at its own `DaySection` type, so
 *    no nominal alias RN exports can name it (`renderSectionHeader` is
 *    contravariant in the section type). The capability union accepts every
 *    concretely-typed list without a cast.
 *
 * A raw scrollable satisfies it directly; an animated
 * `Animated.createAnimatedComponent(ScrollView)` through `getNode`; a
 * `FlatList`/`SectionList` through `getScrollResponder`.
 */
export type TabRootScrollable =
  // `getScrollResponder` is nullable on both RN list components — it returns
  // `null | undefined | ScrollResponderType` before the list has mounted its
  // underlying ScrollView.
  | { getScrollResponder(): ScrollableView | null | undefined }
  | { getNode(): ScrollableView }
  | ScrollableView;

// Resolve the actual scrollable node from a possibly-wrapped ref, exactly as
// React Navigation's `useScrollToTop` does, so a raw `ScrollView`, an animated
// (`getNode`) ScrollView, and a `FlatList`/`SectionList` (`getScrollResponder`)
// all work.
const getScrollableNode = (ref: RefObject<TabRootScrollable | null>): ScrollableView | null => {
  const node = ref.current;

  if (node == null) {
    return null;
  }

  if (
    'scrollToTop' in node ||
    'scrollTo' in node ||
    'scrollToOffset' in node ||
    'scrollResponderScrollTo' in node
  ) {
    return node;
  }

  if ('getScrollResponder' in node) {
    return node.getScrollResponder() ?? null;
  }

  if ('getNode' in node) {
    return node.getNode();
  }

  // Unreachable for a well-typed caller: TabRootScrollable is exactly the six
  // members tested above, so `node` is `never` here. A node with none of them
  // could not be scrolled anyway — the previous cast-and-return reached
  // `scrollToTrueTop`, which then matched no branch and did nothing, so this is
  // the same no-op stated honestly.
  return null;
};

// Drive the resolved node to the true top. Identical branch structure to
// `useScrollToTop`, but with the caller's negative target (the expanded
// large-title top) instead of `0`, so the animated scroll lands at the fully
// expanded large-title top rather than one collapsed-header height below it.
const scrollToTrueTop = (scrollable: ScrollableView, target: number): void => {
  if ('scrollTo' in scrollable) {
    scrollable.scrollTo({ y: target, animated: true });
    return;
  }

  if ('scrollToOffset' in scrollable) {
    scrollable.scrollToOffset({ offset: target, animated: true });
    return;
  }

  if ('scrollResponderScrollTo' in scrollable) {
    scrollable.scrollResponderScrollTo({ y: target, animated: true });
    return;
  }

  if ('scrollToTop' in scrollable) {
    // `scrollToTop()` takes no offset, so it lands at `y: 0` — one inset below
    // the true top. Our tab roots are `ScrollView` / `SectionList`, so this
    // branch is never reached; it is kept only for structural parity.
    scrollable.scrollToTop();
  }
};

// Walk the parent navigator chain and collect every tab navigator, exactly as
// `useScrollToTop` does, so a screen nested under multiple tab navigators scrolls
// for any of them.
const collectTabNavigations = (
  navigation: NavigationProp<ParamListBase>,
): NavigationProp<ParamListBase>[] => {
  const tabNavigations: NavigationProp<ParamListBase>[] = [];
  let current: NavigationProp<ParamListBase> | undefined = navigation;

  while (current) {
    if (current.getState().type === 'tab') {
      tabNavigations.push(current);
    }

    current = current.getParent();
  }

  return tabNavigations;
};

/**
 * Scrolls a tab-root screen's primary scrollable back to the true top (animated)
 * when the user re-taps the already-active bottom-tab item — the standard iOS
 * "re-tap the active tab → scroll to top" behaviour.
 *
 * This mirrors React Navigation's own `useScrollToTop` — it walks the parent
 * chain to the tab navigator, subscribes to `tabPress`, gates the scroll on the
 * screen being focused AND on being the first route of its stack (so a re-tap on
 * a pushed detail does not scroll), respects `preventDefault`, and defers the
 * scroll one frame so all other `tabPress` listeners have run — with one
 * deliberate difference: it scrolls to `-expandedHeaderHeight` rather than a
 * literal `y: 0`.
 *
 * The reason: the native-stack large-title tab roots (Statistics / Accounts /
 * Settings) render inside the `Screen` primitive's `ScrollView`, which sets
 * `contentInsetAdjustmentBehavior="automatic"`. At the fully expanded top the
 * content offset is negative (the large-title band), so `useScrollToTop`'s
 * `y: 0` lands one inset-height below the true top and leaves the large title
 * hidden. That `ScrollView` also sets `scrollToOverflowEnabled`, which disables
 * RN's own clamp, and iOS does not clamp an animated programmatic scroll — so a
 * negative target reaches UIKit verbatim and an over-large one parks the content
 * in a void of empty space with nothing to bring it back.
 *
 * The target is therefore the EXPANDED header height the device itself reports
 * (see `expandedHeaderHeight` in the body), not a live height plus a guessed
 * constant, and the optional `scrollOffset` lets the hook skip the scroll
 * entirely when the content is already at or above that target. Home hides its
 * header (`headerHeight` is 0, target 0) and its `SectionList` is not the
 * overflow-enabled ScrollView, so RN still clamps its 0 target — Home is
 * unaffected either way.
 */
export const useScrollToTopOnTabPress = (
  ref: RefObject<TabRootScrollable | null>,
  // The live scroll offset (reanimated's `useScrollOffset` on the same animated
  // ref the caller already holds). Optional: a caller without an animated ref
  // (Home's `SectionList`) does not need it — its target is `0` and RN clamps
  // that anyway.
  scrollOffset?: { value: number },
): void => {
  const navigation = useContext(NavigationContext);
  const route = useRoute();
  // Read the header inset directly from context (rather than `useHeaderHeight()`)
  // so a missing header context degrades to `0` instead of throwing. Every tab
  // root that uses this hook renders under a native-stack header, so the context
  // is present there; a standalone render (or the header-hidden Home) falls back
  // to `0`.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  // The window frame, so the tracked expanded height below is discarded on a
  // frame-size change (a rotation, an iPad split-view resize): a landscape
  // header is shorter than a portrait one, and keeping the larger portrait
  // maximum would scroll past the top in landscape.
  const { width, height } = useWindowDimensions();

  // The EXPANDED large-title header height, as the DEVICE reports it — the
  // maximum `HeaderHeightContext` value seen since mount (or since the last
  // frame-size change).
  //
  // WHY A TRACKED MAXIMUM AND NOT `headerHeight + 52`: `HeaderHeightContext`
  // reports the LIVE, currently-animating header height, not a collapsed
  // baseline — @react-navigation/native-stack feeds it from the native
  // `onHeaderHeightChange` event (and debounces it precisely because it changes
  // constantly on a large-title screen), and react-native-screens computes it as
  // `navigationBar.frame.size.height + origin.y`, re-emitted on every layout
  // pass. Adding a hardcoded 52pt band to it double-counted the band whenever
  // the large title was ALREADY expanded — i.e. whenever the user was already at
  // the top — and scrolled 52pt PAST the real top. Nothing clamped that:
  // `Screen` sets `scrollToOverflowEnabled` (exactly the branch RN skips its
  // bounds clamp on) and UIKit does not rubber-band an animated programmatic
  // `setContentOffset`, so the content parked in a black void and stayed there.
  //
  // A tab root mounts at the top, so the expanded height is observed within the
  // first frames, once native emits it (the context's initial value is the
  // collapsed default); the maximum is exact from then on rather than a guessed
  // constant.
  const expandedHeaderHeight = useRef(0);
  const trackedFrame = useRef({ width, height });
  // The header height that was still live when the frame changed — i.e. the
  // PRE-rotation one, which the context keeps reporting until the next native
  // emit lands. `undefined` means "nothing stale to ignore".
  const staleHeaderHeight = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Only a REAL frame change discards the tracked height. The ref starts at
    // the mount frame, so this effect's own mount run (and a StrictMode
    // remount) sees the same frame and keeps the height the first render
    // already observed — resetting unconditionally here would wipe it before
    // the very first tap. After a real change the maximum re-establishes itself
    // from the next `onHeaderHeightChange`; until then the target is `0`, which
    // is short of the top but never past it.
    if (trackedFrame.current.width === width && trackedFrame.current.height === height) {
      return;
    }

    trackedFrame.current = { width, height };
    expandedHeaderHeight.current = 0;
    staleHeaderHeight.current = headerHeight;
  }, [width, height, headerHeight]);

  // Deliberate render-phase writes to refs (not state): they cannot trigger a
  // re-render, and they must run before a `tabPress` that arrives ahead of the
  // next effect flush reads them.
  //
  // native-stack re-emits the header height through a 100ms debounce, so for a
  // moment after a rotation the context still reports the PRE-rotation height.
  // Any render in that window (a live-query tick, the frame change propagating)
  // would otherwise re-latch the just-discarded portrait maximum and make every
  // landscape tap overshoot, so the maximum stays frozen until a height OTHER
  // than the stale one arrives — which only the post-rotation native emit can
  // produce. If the new frame's height happens to equal the old one, the
  // maximum simply stays `0` (short of the top, never past it).
  if (staleHeaderHeight.current !== undefined && headerHeight !== staleHeaderHeight.current) {
    staleHeaderHeight.current = undefined;
  }

  if (staleHeaderHeight.current === undefined && headerHeight > expandedHeaderHeight.current) {
    expandedHeaderHeight.current = headerHeight;
  }

  if (navigation === undefined) {
    throw new Error(
      "Couldn't find a navigation object. Is your component inside NavigationContainer?",
    );
  }

  useEffect(() => {
    const tabNavigations = collectTabNavigations(navigation);

    if (tabNavigations.length === 0) {
      return;
    }

    const unsubscribers = tabNavigations.map((tab) =>
      tab.addListener(
        // We don't import the tab-navigator types here to avoid an extra dep, and
        // there are multiple tab implementations.
        // @ts-expect-error the `tabPress` event is only available when navigation type is tab
        'tabPress',
        (e: EventArg<'tabPress', true>) => {
          // Scroll only when this screen is the focused one...
          const isFocused = navigation.isFocused();

          // ...and only when it is the first screen of its stack (a `tabPress`
          // resets a nested stack to its first route, so re-tapping while a
          // detail is pushed must not scroll the underlying root).
          const isFirst =
            tabNavigations.includes(navigation) ||
            navigation.getState().routes[0].key === route.key;

          // Defer to the next frame so every other `tabPress` listener has run;
          // this is how we know whether `preventDefault()` was called.
          requestAnimationFrame(() => {
            const scrollable = getScrollableNode(ref);

            if (!isFocused || !isFirst || !scrollable || e.defaultPrevented) {
              return;
            }

            // The expanded large-title top, as the device reported it. No
            // hardcoded band — see `expandedHeaderHeight` above. A header-hidden
            // screen (Home) reports `0`, so the target stays `0` and RN's own
            // clamp handles it.
            const target = -expandedHeaderHeight.current;

            // If the content is ALREADY at or above the target, skip: the
            // scroll would either do nothing (redundant) or, for a target that
            // UNDERSHOOTS the real top, push the content back DOWN away from
            // the top. Note what this does not do — it cannot stop an
            // OVERSHOOTING target from parking the content in a void, because
            // an over-large target is by definition below (more negative than)
            // the current offset and passes this check. Not producing a void is
            // the target's job, and the target is the height the device itself
            // reported.
            if (scrollOffset !== undefined && scrollOffset.value <= target) {
              return;
            }

            scrollToTrueTop(scrollable, target);
          });
        },
      ),
    );

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [navigation, ref, route.key, scrollOffset]);
};
