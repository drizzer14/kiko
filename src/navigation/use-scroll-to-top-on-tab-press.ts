import { useScrollToTop } from '@react-navigation/native';
import type { RefObject } from 'react';
import type { FlatList, ScrollView, SectionList } from 'react-native';

/**
 * A tab-root screen's primary scrollable, the surface an active-tab re-tap
 * returns to the top: the Home transactions `SectionList`, or the `ScrollView`
 * behind the `Screen` primitive's `scroll` mode (Statistics / Accounts /
 * Settings). `FlatList` is included so a future list-backed tab root fits too.
 */
export type TabRootScrollable = ScrollView | FlatList<unknown> | SectionList<unknown>;

/**
 * Scrolls a tab-root screen's primary scrollable back to the top (animated)
 * when the user taps the already-active bottom-tab item — the standard iOS
 * "re-tap the active tab → scroll to top" behaviour.
 *
 * The native bottom-tab navigator (`@bottom-tabs/react-navigation` on
 * `react-native-bottom-tabs`) emits React Navigation's `tabPress` event on
 * every tab-item tap, including a re-tap of the focused tab: its
 * `NativeBottomTabView` calls `navigation.emit({ type: 'tabPress' })` from
 * `onIndexChange`, and the native `TabItemEventModifier` fires that even when
 * the reselected tab is already selected (its `isReselectingSameTab` branch).
 * The navigator is built on `TabRouter`, so its state reports `type: 'tab'` —
 * which is exactly what React Navigation's own `useScrollToTop` walks the
 * parent chain for. `useScrollToTop` therefore works as-is here: it owns the
 * `tabPress` subscription, gates the scroll on the screen being focused AND on
 * the tab's own root screen (so a re-tap on a pushed detail does not scroll),
 * respects `preventDefault`, and drives the ref. This hook only centralises the
 * ref type at one seam so each tab root wires it the same way.
 */
export const useScrollToTopOnTabPress = (ref: RefObject<TabRootScrollable | null>): void => {
  // `useScrollToTop`'s public parameter is a private `ScrollableWrapper` union
  // (a node exposing `scrollTo` / `scrollToOffset` / `getScrollResponder`).
  // Every scrollable above satisfies it structurally but not nominally, so the
  // cast lives here once instead of in every screen.
  useScrollToTop(ref as unknown as Parameters<typeof useScrollToTop>[0]);
};
