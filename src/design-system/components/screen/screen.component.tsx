import type { FC } from 'react';
import { ScrollView, View } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveBottomClearance } from './bottom-clearance';
import type { ScreenProps } from './screen.props';
import { styles } from './screen.styles';

// A large-title navigator header owns the top inset itself, so any branch whose
// content sits under one drops the SafeAreaView's top edge — keeping it would
// double-offset content beneath the header (see the redesign feedback round-1
// brief, task 3, for the root cause). Used by the always-scrolling `scroll`
// branch AND by the plain branch's `bleedTop` opt-in (a large-title screen
// whose child is itself the scrollable surface, e.g. HoldingDetail's ledger
// FlatList — feedback round-2, item 2).
const LARGE_TITLE_SAFE_AREA_EDGES = ['left', 'right', 'bottom'] as const;

const Screen: FC<ScreenProps> = ({
  children,
  scroll = false,
  footer,
  bleedBottom = false,
  bleedTop = false,
  scrollableRef,
}) => {
  // The native glass tab bar floats over the screen's bottom edge, so any
  // content that reaches the screen's true bottom edge must clear it —
  // universally, from this one place — rather than each screen re-solving it.
  // Lift it by the bar's *measured* height. That height is
  // `UITabBar.frame.size.height` (react-native-bottom-tabs measures the real
  // frame; see its `TabViewImpl.swift`), which already spans the bottom
  // safe-area inset — the bar's background extends to the screen's true bottom
  // edge. The tab bar remains visible on pushed native-stack screens (the
  // SwiftUI TabView draws it independently of each tab's nested stack — you
  // can still switch tabs from a pushed form, see `reset-tab-stack-on-blur.ts`),
  // so this one clearance is correct on tab roots and pushed screens alike.
  // Every current Screen consumer is nested under the native tab navigator
  // (see `root.navigator.tsx`), so the hook always has its context here; the
  // global Jest manual mock returns 0 for standalone renders. Used by the
  // scroll branch's `footer` below and by the plain branch's `content` — never
  // both on one render, since `scroll` selects exactly one return path.
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  // Both `SafeAreaView` branches below already reserve `insets.bottom`
  // themselves as real padding — `edges` includes `'bottom'` in the scroll
  // branch's explicit list, and in the plain branch's default (an unset
  // `edges` prop reserves every edge). Adding the FULL tab-bar height again
  // on top of that reservation double-counts the inset. See
  // `bottom-clearance.ts` for the shared arithmetic (also used by every
  // `bleedBottom` child, e.g. Home's transaction list) and its full rationale.
  const bottomClearance = resolveBottomClearance(tabBarHeight, insets.bottom);
  // The plain branch's `content` reserves the clearance itself only when it is
  // both the screen's true bottom edge AND has nothing else claiming that job:
  // a `footer` (pinned below it, see the plain-branch return) or a
  // `bleedBottom` child (a scrollable list applying the clearance to its own
  // content) each own it instead — reserving it in `content` too would count
  // it twice.
  const contentOwnsClearance = !bleedBottom && footer === undefined;

  if (scroll) {
    return (
      <SafeAreaView edges={LARGE_TITLE_SAFE_AREA_EDGES} style={styles.safeArea}>
        <ScrollView
          ref={scrollableRef}
          testID="screen-scroll-view"
          contentInsetAdjustmentBehavior="automatic"
          // RN's `scrollTo` clamps a programmatic negative y back to `0`, so the
          // scroll-to-top hook's negative target — more negative than that `0`
          // top edge — would be clamped away and the collapsed large title would
          // never re-expand. This prop disables RN's clamp, letting the negative
          // target reach iOS `setContentOffset`.
          //
          // The trade-off: with the clamp off, iOS does NOT clamp an animated
          // programmatic scroll either, so an over-large target parks the content
          // in a void of empty space with nothing to bring it back. Only a
          // correct target prevents that, so the hook targets the EXPANDED header
          // height the DEVICE itself reports rather than adding a guessed
          // constant to a live value — exactly the bug that produced a 52pt void
          // when the large title was already open. (Its "already at or above the
          // target" skip is a separate guard, against a redundant scroll and
          // against an UNDERSHOOTING target pushing content back down; it cannot
          // catch an overshoot.) See `use-scroll-to-top-on-tab-press.ts`.
          //
          // Programmatic-scroll only; user scrolling is unaffected.
          scrollToOverflowEnabled={true}
          // Default "never" consumes the first tap to dismiss the keyboard, so
          // focusing another input (or opening a date field) needs a second
          // tap. "handled" fires a focusable/handled child on the first tap
          // while still dismissing the keyboard on taps to inert areas.
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent(footer !== undefined)}
        >
          {children}
        </ScrollView>
        {footer ? (
          <View testID="screen-footer" style={styles.footer(bottomClearance)}>
            {footer}
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  // The plain (non-scrolling) branch: `content` and `footer` (when present)
  // are siblings in the same flex column, `content` taking `flex: 1` — so a
  // short page's footer still lands pinned to the screen's true bottom edge,
  // exactly like the scroll branch's footer, rather than floating directly
  // beneath a short page's content.
  return (
    <SafeAreaView
      // A `bleedTop` screen's child is itself the scrollable surface under a
      // large-title header, so — like the scroll branch above — the top edge is
      // dropped here and the child (via its own automatic content-inset
      // adjustment) owns the top inset. Every other plain (headerless) screen
      // keeps the default all-edges reservation.
      edges={bleedTop ? LARGE_TITLE_SAFE_AREA_EDGES : undefined}
      style={styles.safeArea}
    >
      <View
        testID="screen-content"
        style={styles.content(contentOwnsClearance, bottomClearance, bleedTop)}
      >
        {children}
      </View>
      {footer ? (
        <View testID="screen-footer" style={styles.footer(bottomClearance)}>
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
};

export default Screen;
