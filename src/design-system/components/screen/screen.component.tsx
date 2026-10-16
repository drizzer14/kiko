import type { FC } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FieldBlurContext } from '@kiko/design-system/field-blur';

import LargeTitleHeading, { useLargeTitleScroll } from '../large-title-heading';

import { styles } from './screen.styles';
import type { ScreenProps } from './screen.props';
import { useBottomClearance } from './use-bottom-clearance';
import { useContentCap, usePaneScreen, useScrollIndicatorProps } from './use-pane-screen';

const Screen: FC<ScreenProps> = ({
  children,
  scroll = false,
  footer,
  bleedBottom = false,
  bleedTop = false,
  scrollableRef,
  onContentSizeChange,
  automaticallyAdjustKeyboardInsets = true,
  onFieldBlur,
}) => {
  // The fields' way to report a blur to the screen; every layout below renders them.
  const fields = (
    <FieldBlurContext.Provider value={onFieldBlur}>{children}</FieldBlurContext.Provider>
  );

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
  //
  // Every branch's `SafeAreaView` reserves `insets.bottom` itself when its
  // edges include the bottom one (always outside a pane; in a pane only when
  // the pane touches the window's bottom). Adding the FULL tab-bar height
  // again on top of that reservation double-counts the inset. See
  // `bottom-clearance.ts` for the shared arithmetic and `use-bottom-clearance.ts`
  // for the hook every `bleedBottom` child, e.g. Home's transaction list, uses
  // too: it also gives a pane that is not at the window's bottom no clearance,
  // since no tab bar is over it.
  const bottomClearance = useBottomClearance();
  const contentCap = useContentCap();
  const scrollIndicatorProps = useScrollIndicatorProps();
  const { plainEdges, largeTitleEdges } = usePaneScreen();
  // The plain branch's `content` reserves the clearance itself only when it is
  // both the screen's true bottom edge AND has nothing else claiming that job:
  // a `footer` (pinned below it, see the plain-branch return) or a
  // `bleedBottom` child (a scrollable list applying the clearance to its own
  // content) each own it instead — reserving it in `content` too would count
  // it twice.
  const contentOwnsClearance = !bleedBottom && footer === undefined;
  // Only set while the screen's title is too long for the native large title and shows as a
  // heading in the content (see `LargeTitleHeading`); otherwise it adds nothing.
  const headingScrollProps = useLargeTitleScroll();

  if (scroll) {
    return (
      <SafeAreaView edges={largeTitleEdges} style={styles.safeArea}>
        <ScrollView
          ref={scrollableRef}
          testID="screen-scroll-view"
          contentInsetAdjustmentBehavior="automatic"
          {...scrollIndicatorProps}
          // iOS-only: when the keyboard changes size, iOS adjusts this scroll
          // view's contentInset/scrollIndicatorInsets and scrolls the first
          // responder above the keyboard — the shared, app-wide auto-scroll so
          // a focused input never hides behind the keyboard. The iOS Done
          // accessory's height is part of the native keyboard frame, so this
          // one inset clears BOTH the keyboard and the accessory (no
          // hand-rolled accessory-height math). Harmlessly ignored on Android.
          //
          // This prop has no per-responder scoping — it reacts to ANY
          // focused input, including one hosted inside a BottomSheet
          // floating above this ScrollView (CurrencyField's search
          // TextField is the one such case in the app today), which
          // misfires a scroll/inset adjustment on THIS background
          // ScrollView for a responder it does not even contain, and never
          // self-corrects. `automaticallyAdjustKeyboardInsets` is therefore
          // a real escape hatch (see `ScreenProps`): a caller that hosts
          // such a sheet gates it off for the duration the sheet is open
          // (`CurrencyField`'s `onOpenChange`; see account-form/holding-form)
          // and back on once it closes.
          automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
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
          onContentSizeChange={onContentSizeChange}
          // Default "never" consumes the first tap to dismiss the keyboard, so
          // focusing another input (or opening a date field) needs a second
          // tap. "handled" fires a focusable/handled child on the first tap
          // while still dismissing the keyboard on taps to inert areas.
          keyboardShouldPersistTaps="handled"
          // In a pane the content is capped and centred here, not on the scroll
          // view, so the scroll view and its indicator span the whole pane.
          contentContainerStyle={[styles.scrollContent(footer !== undefined), contentCap]}
          {...headingScrollProps}
        >
          <LargeTitleHeading />

          {fields}
        </ScrollView>
        {footer ? (
          <View testID="screen-footer" style={[styles.footer(bottomClearance), contentCap]}>
            {footer}
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  // The `bleedTop` branch: the child is ITSELF the scrollable surface under a
  // native large-title header (a virtualized FlatList/SectionList that must own
  // the scrolling, so it cannot nest inside the `scroll` branch's ScrollView).
  // iOS drives the large-title COLLAPSE from the first scroll view it finds
  // walking the screen's first-child chain (react-native-screens'
  // `RNSScrollViewFinder.findScrollViewInFirstDescendantChainFrom` walks
  // `subviews[0]`, and its own comment notes "the OS does something similar when
  // looking for scrollview for large header"). An intermediate padded `content`
  // View between the SafeAreaView and that scroll view stops the collapse — the
  // large title stays stuck expanded. So `bleedTop`
  // renders the child as a DIRECT child of the SafeAreaView, exactly like the
  // working `account-detail` scroll branch's ScrollView (its proven structure:
  // collapses AND does not float). There is no `content` wrapper, so the child
  // owns ALL of its own padding — top (via `contentInsetAdjustmentBehavior`
  // "automatic" + its own content-container top padding), horizontal, AND the
  // floating tab-bar bottom clearance (the same `bleedBottom` contract Home's
  // list follows, via `useBottomClearance()`). The top safe-area edge is
  // dropped here for the same reason the scroll branch drops it: the large-title
  // header owns the top inset. A `footer` still sits pinned below the child as a
  // sibling, with its own clearance, exactly as in the other two branches.
  if (bleedTop) {
    return (
      <SafeAreaView edges={largeTitleEdges} style={styles.safeArea}>
        {fields}
        {footer ? (
          <View testID="screen-footer" style={[styles.footer(bottomClearance), contentCap]}>
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
  // beneath a short page's content. `bleedTop` returns above, so this branch is
  // always a headerless screen: it keeps the all-edges reservation, or in a
  // pane only the edges the pane touches. With no scroll view of its own, it
  // takes the pane cap on its root. A `bleedBottom` child is itself the
  // scrollable surface, so a cap on the root would narrow its scroll indicator
  // too: it caps its own content (`useContentCap()`), and only the footer is
  // capped here.
  return (
    <SafeAreaView
      edges={plainEdges}
      style={[styles.safeArea, bleedBottom ? undefined : contentCap]}
    >
      <View testID="screen-content" style={styles.content(contentOwnsClearance, bottomClearance)}>
        {fields}
      </View>
      {footer ? (
        <View
          testID="screen-footer"
          style={[styles.footer(bottomClearance), bleedBottom ? contentCap : undefined]}
        >
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
};

export default Screen;
