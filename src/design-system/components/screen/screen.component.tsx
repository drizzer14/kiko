import type { FC } from 'react';
import {
  FloatingFooterContext,
  FloatingFooterEndContext,
} from '@kiko/design-system/floating-footer';
import { useDisplayRegions } from '@kiko/display-regions';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FieldBlurContext } from '@kiko/design-system/field-blur';
import { type LayoutChangeEvent, ScrollView, View } from 'react-native';

import LargeTitleHeading, { useLargeTitleScroll } from '../large-title-heading';

import {
  useAutomaticScrollClearance,
  useBottomClearance,
  useIsBottomInsetPadded,
} from './use-bottom-clearance';
import type { ScreenProps } from './screen.props';
import { useTopClearance } from './use-top-clearance';
import { useContentMargin } from './use-content-margin';
import { SIDE_BAR_PLATTER_INSET, styles } from './screen.styles';
import { useFloatingFooterHeight } from './use-floating-footer-height';
import { useContentCap, usePaneScreen, useScrollIndicatorProps } from './use-pane-screen';

type FooterSlotProps = Pick<ScreenProps, 'footer' | 'floatingFooter'> & {
  bottomClearance: number;
  sideBarInset: number | undefined;
  contentMargin: number;
  capStyle: ReturnType<typeof useContentCap>;
  onFloatingLayout: (event: LayoutChangeEvent) => void;
};

// The footer slot of all three branches. Pinned, it is a sibling below the scroll surface.
// Floating, it is an overlay: a zero-height anchor sits in the flex column after the surface,
// inside the SafeAreaView's padding (the safe-area insets and the side bar), and the overlay
// grows upward from the anchor's bottom edge. `box-none` leaves every touch outside the buttons
// to the rows beneath. The overlay's measured height is what the content pads its end by.
const FooterSlot: FC<FooterSlotProps> = ({
  footer,
  floatingFooter = false,
  bottomClearance,
  sideBarInset,
  contentMargin,
  capStyle,
  onFloatingLayout,
}) => {
  // The size class, as `useContentCap` reads it: a regular window, whatever its live layout mode.
  const { horizontalSizeClass } = useDisplayRegions();

  if (!footer) {
    return null;
  }

  const isButtonWidthCapped = floatingFooter && horizontalSizeClass === 'regular';

  const slot = (
    <View
      testID="screen-footer"
      pointerEvents={floatingFooter ? 'box-none' : undefined}
      onLayout={floatingFooter ? onFloatingLayout : undefined}
      style={[
        styles.footer(bottomClearance, contentMargin, sideBarInset),
        capStyle,
        isButtonWidthCapped ? styles.floatingFooterCap(contentMargin) : undefined,
      ]}
    >
      {footer}
    </View>
  );

  if (!floatingFooter) {
    return slot;
  }

  return (
    <View pointerEvents="box-none" style={styles.floatingFooterAnchor}>
      <View pointerEvents="box-none" style={styles.floatingFooter}>
        <FloatingFooterContext.Provider value={true}>{slot}</FloatingFooterContext.Provider>
      </View>
    </View>
  );
};

const Screen: FC<ScreenProps> = ({
  children,
  scroll = false,
  footer,
  floatingFooter = false,
  bleedBottom = false,
  bleedTop = false,
  belowHeader,
  uncapped,
  scrollableRef,
  onContentSizeChange,
  automaticallyAdjustKeyboardInsets = true,
  onFieldBlur,
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
  // Beside a side bar the SafeAreaView drops its bottom edge so the scroll views run to the
  // window's bottom, and the inset comes back as padding. The scroll branch's ScrollView adjusts
  // itself (`automatic`), so it asks `useAutomaticScrollClearance` what UIKit leaves to the JS.
  const isBottomInsetPadded = useIsBottomInsetPadded();
  const automaticScrollClearance = useAutomaticScrollClearance();
  const scrollBottomInset = isBottomInsetPadded ? automaticScrollClearance : 0;
  // A floating footer takes no layout room, so the content ends under it unless it pads its end
  // by the footer's measured height. The slot holds its own top gap, the buttons, the tab-bar
  // clearance and the gap below, so a content that ends where the slot begins leaves exactly the
  // slot's top padding between the last row and the first button.
  const hasFloatingFooter = footer !== undefined && floatingFooter;
  // Beside a side bar a floating footer ends level with the bottom of the bar's platter, in place
  // of the gap and the clearance, in a pane that touches the window's bottom. Every other
  // placement, and the pinned footer, keep their own bottom.
  const sideBarInset =
    hasFloatingFooter && isBottomInsetPadded ? SIDE_BAR_PLATTER_INSET : undefined;
  const footerSlot = useFloatingFooterHeight(bottomClearance, sideBarInset);
  // The scroll view ends at the slot's bottom edge too, except beside a side bar, where it runs
  // to the window's bottom and UIKit adds the home-indicator inset to its content itself (the
  // switch in `bottom-clearance.ts`): the padding is the height less that inset. Under a bottom
  // or a top bar the scroll view sits inside the SafeAreaView and UIKit adds nothing.
  const uikitInsetBottom = isBottomInsetPadded ? bottomClearance - automaticScrollClearance : 0;
  const floatingScrollEnd = hasFloatingFooter
    ? Math.max(footerSlot.height - uikitInsetBottom, 0)
    : undefined;
  // The plain branch's `content` is a View: it ends at the slot's bottom edge, UIKit adds nothing.
  // A `bleedBottom` child pads its own end.
  const floatingContentEnd = hasFloatingFooter && !bleedBottom ? footerSlot.height : undefined;
  // The fields' way to report a blur to the screen, and the scroll end a `bleedTop` or
  // `bleedBottom` child pads itself by (it owns its scrolling); every layout below renders them.
  const fields = (
    <FieldBlurContext.Provider value={onFieldBlur}>
      <FloatingFooterEndContext.Provider value={floatingScrollEnd}>
        {children}
      </FloatingFooterEndContext.Provider>
    </FieldBlurContext.Provider>
  );
  // A floating TOP bar covers the top edge the same way, so a headerless plain screen starts
  // below its pill. Only the plain branch uses it: the scroll and `bleedTop` branches sit under a
  // native header that already clears the bar, and so does a plain screen told it is `belowHeader`.
  const topClearance = useTopClearance(belowHeader);
  // The sides of the content, the footer and the scroll content are padded by this one margin.
  const contentMargin = useContentMargin();
  const contentCap = useContentCap(uncapped);
  const scrollIndicatorProps = useScrollIndicatorProps();
  const { plainEdges, largeTitleEdges } = usePaneScreen(belowHeader);
  // The plain branch's `content` reserves the clearance itself only when it is
  // both the screen's true bottom edge AND has nothing else claiming that job:
  // a `footer` (pinned below it, see the plain-branch return) or a
  // `bleedBottom` child (a scrollable list applying the clearance to its own
  // content) each own it instead — reserving it in `content` too would count
  // it twice.
  //
  // A floating footer takes no layout room: the content lays out as if there were no footer, and
  // pads its end by the footer's height instead (`floatingScrollEnd`, `floatingContentEnd`).
  const hasPinnedFooter = footer !== undefined && !floatingFooter;
  const contentOwnsClearance = !bleedBottom && !hasPinnedFooter;
  // A `bleedBottom` child with nothing below it runs to the window's bottom beside a side bar and
  // pads the inset itself, so `content` adds no bottom padding there.
  const isBottomEdgeBled = bleedBottom && !hasPinnedFooter && isBottomInsetPadded;
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
          // The patched React Native (`patches/react-native+0.87.1.patch`) moves this scroll
          // view's offset only for a field inside it; a field outside it (the other pane, a
          // sheet above it) gets the bottom inset alone, which resets when the keyboard hides.
          // So no caller has to switch the prop off while a sheet is open; it stays an escape
          // hatch for a caller that wants no keyboard adjustment at all (see `ScreenProps`).
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
          // In a pane, except a pane under a top tab bar, the content is capped and centred here,
          // not on the scroll view, so the scroll view and its indicator span the whole pane.
          contentContainerStyle={[
            styles.scrollContent(
              hasPinnedFooter,
              contentMargin,
              scrollBottomInset,
              floatingScrollEnd,
            ),
            contentCap,
          ]}
          {...headingScrollProps}
        >
          <LargeTitleHeading />

          {fields}
        </ScrollView>

        <FooterSlot
          footer={footer}
          floatingFooter={floatingFooter}
          bottomClearance={bottomClearance}
          sideBarInset={sideBarInset}
          contentMargin={contentMargin}
          capStyle={contentCap}
          onFloatingLayout={footerSlot.onLayout}
        />
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

        <FooterSlot
          footer={footer}
          floatingFooter={floatingFooter}
          bottomClearance={bottomClearance}
          sideBarInset={sideBarInset}
          contentMargin={contentMargin}
          capStyle={contentCap}
          onFloatingLayout={footerSlot.onLayout}
        />
      </SafeAreaView>
    );
  }

  // The plain (non-scrolling) branch: `content` and `footer` (when present)
  // are siblings in the same flex column, `content` taking `flex: 1` — so a
  // short page's footer still lands pinned to the screen's true bottom edge,
  // exactly like the scroll branch's footer, rather than floating directly
  // beneath a short page's content. `bleedTop` returns above, so this branch is a headerless
  // screen unless it is `belowHeader`: it keeps the all-edges reservation, or in a pane only the
  // edges the pane touches, and under a shown header it drops the top one (`usePaneScreen`), since
  // the header owns that inset. With no scroll view of its own, it
  // takes the pane cap on its root. A `bleedBottom` child is itself the
  // scrollable surface, so a cap on the root would narrow its scroll indicator
  // too: it caps its own content (`useContentCap()`), and only the footer is
  // capped here.
  return (
    <SafeAreaView
      edges={plainEdges}
      style={[styles.safeArea, bleedBottom ? undefined : contentCap]}
    >
      <View
        testID="screen-content"
        style={styles.content(
          contentOwnsClearance,
          bottomClearance,
          topClearance,
          contentMargin,
          isBottomEdgeBled,
          floatingContentEnd,
        )}
      >
        {fields}
      </View>

      <FooterSlot
        footer={footer}
        floatingFooter={floatingFooter}
        bottomClearance={bottomClearance}
        sideBarInset={sideBarInset}
        contentMargin={contentMargin}
        capStyle={bleedBottom ? contentCap : undefined}
        onFloatingLayout={footerSlot.onLayout}
      />
    </SafeAreaView>
  );
};

export default Screen;
