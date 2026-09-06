import type { FC } from 'react';
import { ScrollView, View } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ScreenProps } from './screen.props';
import { styles } from './screen.styles';

// A large-title navigator header owns the top inset itself, so scroll mode
// drops the SafeAreaView's top edge here — keeping it would double-offset
// content beneath the header (see the redesign feedback round-1 brief,
// task 3, for the root cause).
const SCROLL_SAFE_AREA_EDGES = ['left', 'right', 'bottom'] as const;

const Screen: FC<ScreenProps> = ({
  children,
  scroll = false,
  footer,
  bleedBottom = false,
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
  // `edges` prop reserves every edge). `RNCSafeAreaViewShadowNode`'s
  // `'additive'` edge mode literally adds the inset to whatever padding was
  // already on the view (`insets.bottom + edgeValue`), so that reservation is
  // real native padding one level up from `footer`/`content`, not merely a
  // hook value nothing yet consumes. Since the tab bar's measured height
  // above already spans that same inset, adding the FULL tab-bar height again
  // here — on top of what `SafeAreaView` already reserved — double-counts the
  // inset a second time and pushes the footer a whole home-indicator strip
  // too high (the "bottom margin is bigger than the top margin" bug). Only
  // the amount by which the tab bar exceeds what `SafeAreaView` already
  // reserved needs adding here. `Math.max(..., 0)` keeps this from going
  // negative on a tab-bar-less consumer where `tabBarHeight` is 0 and
  // `insets.bottom` alone exceeds it — `SafeAreaView`'s own reservation is
  // then already the full, correct clearance and this adds nothing on top.
  const bottomClearance = Math.max(tabBarHeight - insets.bottom, 0);
  // The plain branch's `content` reserves the clearance itself only when it is
  // both the screen's true bottom edge AND has nothing else claiming that job:
  // a `footer` (pinned below it, see the plain-branch return) or a
  // `bleedBottom` child (a scrollable list applying the clearance to its own
  // content) each own it instead — reserving it in `content` too would count
  // it twice.
  const contentOwnsClearance = !bleedBottom && footer === undefined;

  if (scroll) {
    return (
      <SafeAreaView edges={SCROLL_SAFE_AREA_EDGES} style={styles.safeArea}>
        <ScrollView
          ref={scrollableRef}
          testID="screen-scroll-view"
          contentInsetAdjustmentBehavior="automatic"
          // RN's `scrollTo` clamps a programmatic negative y back to `0`, so the
          // scroll-to-top hook's `-headerHeight` target — more negative than that
          // `0` top edge — would be clamped away and the collapsed large title
          // would never re-expand. This prop disables RN's clamp, letting the
          // negative target reach iOS `setContentOffset`. iOS does NOT clamp an
          // animated programmatic scroll, so an UNBOUNDED target would overshoot
          // into a void of empty space; the hook keeps the target bounded to the
          // header inset (`-headerHeight`), which lands exactly at the expanded
          // large-title top and can never overshoot. Programmatic-scroll only;
          // user scrolling is unaffected. See `use-scroll-to-top-on-tab-press.ts`.
          scrollToOverflowEnabled={true}
          // Default "never" consumes the first tap to dismiss the keyboard, so
          // focusing another input (or opening a date field) needs a second
          // tap. "handled" fires a focusable/handled child on the first tap
          // while still dismissing the keyboard on taps to inert areas.
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
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
    <SafeAreaView style={styles.safeArea}>
      <View testID="screen-content" style={styles.content(contentOwnsClearance, bottomClearance)}>
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
