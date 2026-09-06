import { HeaderHeightContext } from '@react-navigation/elements';
import {
  type EventArg,
  NavigationContext,
  type NavigationProp,
  type ParamListBase,
  useRoute,
} from '@react-navigation/native';
import { type RefObject, useContext, useEffect } from 'react';
import type { FlatList, ScrollView, SectionList } from 'react-native';

/**
 * A tab-root screen's primary scrollable, the surface an active-tab re-tap
 * returns to the top: the Home transactions `SectionList`, or the `ScrollView`
 * behind the `Screen` primitive's `scroll` mode (Statistics / Accounts /
 * Settings). `FlatList` is included so a future list-backed tab root fits too.
 */
export type TabRootScrollable = ScrollView | FlatList<unknown> | SectionList<unknown>;

// The iOS large-title band: the extra height the system renders BELOW the
// standard navigation bar for a native-stack large-title screen when fully
// expanded. `HeaderHeightContext` reports only the COLLAPSED header height
// (status bar + standard nav bar), so this band is added to reach the fully
// expanded top. There is no documented JS constant for it — the large title is
// drawn natively by react-native-screens and exposes no height — so this is the
// standard `52`, tuned for the default (non-accessibility) text size. It is a
// deliberate tradeoff: overshooting past the true expanded top reintroduces the
// void (iOS does not clamp the animated programmatic scroll because the `Screen`
// ScrollView has `scrollToOverflowEnabled` on), while undershooting leaves the
// large title partly hidden.
const LARGE_TITLE_BAND = 52;

type ScrollOptions = { x?: number; y?: number; animated?: boolean };

// The private union React Navigation's `useScrollToTop` accepts: a raw
// scrollable, an `Animated.createAnimatedComponent(ScrollView)` (`getNode`), or a
// `FlatList`/`SectionList` wrapper (`getScrollResponder`).
type ScrollableView =
  | { scrollToTop(): void }
  | { scrollTo(options: ScrollOptions): void }
  | { scrollToOffset(options: { offset: number; animated?: boolean }): void }
  | { scrollResponderScrollTo(options: ScrollOptions): void };

type ScrollableWrapper =
  | { getScrollResponder(): ScrollableView }
  | { getNode(): ScrollableView }
  | ScrollableView;

// Resolve the actual scrollable node from a possibly-wrapped ref, exactly as
// React Navigation's `useScrollToTop` does, so a raw `ScrollView`, an animated
// (`getNode`) ScrollView, and a `FlatList`/`SectionList` (`getScrollResponder`)
// all work.
const getScrollableNode = (ref: RefObject<TabRootScrollable | null>): ScrollableView | null => {
  const node = ref.current as unknown as ScrollableWrapper | null;

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
    return node.getScrollResponder();
  }

  if ('getNode' in node) {
    return node.getNode();
  }

  return node as ScrollableView;
};

// Drive the resolved node to the true top. Identical branch structure to
// `useScrollToTop`, but with the expanded large-title target
// (`-(headerHeight + LARGE_TITLE_BAND)`) instead of `0`, so the animated scroll
// lands at the fully expanded large-title top rather than one collapsed-header
// height below it.
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
 * deliberate difference: it scrolls to `-(headerHeight + LARGE_TITLE_BAND)`
 * rather than a literal `y: 0`.
 *
 * The reason: the native-stack large-title tab roots (Statistics / Settings /
 * Accounts) render inside the `Screen` primitive's `ScrollView`, which sets
 * `contentInsetAdjustmentBehavior="automatic"`. At the fully expanded top the
 * content offset is negative (the large-title band), so `useScrollToTop`'s `y: 0`
 * lands one inset-height below the true top and leaves the large title hidden.
 * iOS does NOT clamp an animated programmatic scroll, and that `Screen`
 * ScrollView sets `scrollToOverflowEnabled` (which disables RN's own clamp), so a
 * negative target reaches iOS verbatim — an unbounded target like the former
 * fixed `-1000` therefore parked the content ~1000pt below the top and showed a
 * void of empty space above it. `HeaderHeightContext` reports only the COLLAPSED
 * header height, so the bounded target adds the large-title band
 * (`-(headerHeight + LARGE_TITLE_BAND)`): it lands exactly at the fully expanded
 * large-title top and can never overshoot into a void. Home hides its header
 * (so `headerHeight` is `0`, and the band is NOT added — the target stays `0`)
 * and its `SectionList` is not the overflow-enabled ScrollView, so RN still
 * clamps its `0` target to the top — Home is unaffected.
 */
export const useScrollToTopOnTabPress = (ref: RefObject<TabRootScrollable | null>): void => {
  const navigation = useContext(NavigationContext);
  const route = useRoute();
  // Read the header inset directly from context (rather than `useHeaderHeight()`)
  // so a missing header context degrades to `0` instead of throwing. Every tab
  // root that uses this hook renders under a native-stack header, so the context
  // is present there; a standalone render (or the header-hidden Home) falls back
  // to `0`.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

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

            if (isFocused && isFirst && scrollable && !e.defaultPrevented) {
              // `HeaderHeightContext` reports the COLLAPSED header height, so the
              // large-title band is added to reach the fully expanded top. When
              // there IS a header the bounded target is
              // `-(headerHeight + LARGE_TITLE_BAND)`; when there is none (Home,
              // `headerHeight === 0`) the band is NOT added and the target stays
              // `0`. It lands at the expanded large-title top and never
              // overshoots into a void (see this hook's doc comment).
              const target = -(headerHeight === 0 ? 0 : headerHeight + LARGE_TITLE_BAND);
              scrollToTrueTop(scrollable, target);
            }
          });
        },
      ),
    );

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [navigation, ref, route.key, headerHeight]);
};
