import { StyleSheet } from 'react-native-unistyles';

// The breathing-room gap kept above `bottomClearance` (the call site's
// tab-bar clearance, on top of what the enclosing `SafeAreaView` already
// reserves for the bottom safe-area inset — see `screen.component.tsx`),
// shared by the footer slot and by a plain content edge that owns the true
// screen bottom. Design feedback iterated this down to a minimal step, then
// back up: the bottom gap now MATCHES the footer button's own top margin (the
// `footer` slot's `paddingTop: theme.spacing(4)` below) so the button sits
// symmetrically — the same visual gap above it (content → button) and below
// it (button → tab bar), roughly a capital letter's height. The button still
// always clears the bar via `bottomClearance`; this is purely the extra room
// above it, kept equal to the room above the button.
export const FOOTER_GAP_STEP = 4;

// Beside a side tab bar the floating footer's lowest button ends this far above the window's
// bottom, level with the bottom of the side bar's platter. Pixel-measured on the Duo, iOS 27.2
// (IMG_7263 and IMG_7264, 2026-10-30): the visible platter is 48 x 212 pt, and its bottom gap
// equals its trailing gap at 24 pt in both side poses. A live read of the platter may replace it.
export const SIDE_BAR_PLATTER_INSET = 24;

export const styles = StyleSheet.create((theme) => ({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  // A screen in one of two panes, except a pane under a top tab bar: centred in the pane, never
  // wider than the pane max width.
  paneCap: {
    width: '100%',
    maxWidth: theme.layout.paneMaxWidth,
    alignSelf: 'center',
  },
  // The plain (non-scroll) branch's content container. When it owns the
  // screen's true bottom edge itself (no `footer`, no `bleedBottom` child),
  // its bottom padding is lifted clear of the floating native glass tab bar by
  // `bottomClearance` (the tab bar's measured height MINUS whatever the
  // enclosing `SafeAreaView` already reserves for the bottom safe-area inset,
  // computed at the call site — see `screen.component.tsx`), plus the same
  // base `theme.spacing(FOOTER_GAP_STEP)`
  // gap `footer` below adds on top of its own clearance — the ideal bottom
  // gap, standardized across every Screen bottom-edge path (see `footer`).
  // When a `footer` or a `bleedBottom` child owns the bottom edge instead,
  // `ownsClearance` is `false` and this container's own bottom padding drops
  // to the plain base spacing step — the clearance and its gap belong to
  // whichever sibling (`footer`) or child (the `bleedBottom` list) is
  // actually adjacent to the true bottom edge, not to this container as well,
  // or the gap below the last row/action would be counted twice. Horizontal
  // padding is the content margin (`useContentMargin`) regardless, and the top
  // padding stays at the base spacing step, plus `topClearance` below a
  // floating top tab bar.
  //
  // A `bleedBottom` child beside a side bar (`isBottomEdgeBled`) runs to the window's bottom, so
  // this container takes no bottom padding: the child's own content pads the gap and the inset.
  //
  // Above a floating footer (`floatingFooterHeight` set) the bottom padding is that measured
  // height instead: the slot already holds the tab-bar clearance and the gap below its buttons.
  content: (
    ownsClearance: boolean,
    bottomClearance: number,
    topClearance: number,
    contentMargin: number,
    isBottomEdgeBled: boolean,
    floatingFooterHeight: number | undefined,
  ) => {
    const unownedBottomPadding = isBottomEdgeBled ? 0 : theme.spacing(4);

    return {
      flex: 1,
      // A large-title `bleedTop` screen never reaches this wrapper — it renders
      // its scrollable child directly under the SafeAreaView (see
      // `screen.component.tsx`) so the child, not this padded View, is the scroll
      // view iOS tracks for the large-title collapse. So this wrapper always keeps
      // the base top padding for the headerless/non-scrolling screens that DO use
      // it. The SafeAreaView reserves only the top inset, so a top bar's pill
      // (`topClearance`) is added here, never on the SafeAreaView.
      paddingTop: theme.spacing(4) + topClearance,
      paddingHorizontal: contentMargin,
      paddingBottom:
        floatingFooterHeight ??
        (ownsClearance ? theme.spacing(FOOTER_GAP_STEP) + bottomClearance : unownedBottomPadding),
    };
  },
  // The scroll-mode content container: no `flex: 1` by default (a
  // ScrollView's content container sizes to its content, not the viewport),
  // same padding as the non-scroll `content` above (the base step, but the
  // content margin on the sides). When a `footer` sits below it (outside the
  // ScrollView, as a sibling — see
  // `screen.component.tsx`), this container drops its own bottom padding so
  // the footer's own `paddingTop: theme.spacing(FOOTER_GAP_STEP)` below is the
  // ONE gap above the footer button, instead of both adding
  // `theme.spacing(FOOTER_GAP_STEP)` back to back — the doubled,
  // disproportionate gap feedback flagged on a short unscrolled form (e.g.
  // deposit-edit), since the two views are adjacent siblings with no shared
  // box to collapse the stacked padding. With no `footer`, this container
  // legitimately owns the scroll content's own trailing edge, so it keeps the
  // base bottom padding, plus `bottomInset` where the scroll view reaches the window's bottom
  // beside a side bar and UIKit does not add the inset itself (`resolveAutomaticScrollClearance`).
  //
  // Under a floating footer (`floatingFooterEnd` set) the end padding is the footer's measured
  // height less what UIKit adds itself, so the last row stops at the footer's top edge and the
  // footer's own top padding is the gap to its first button (see `screen.component.tsx`).
  scrollContent: (
    hasFooter: boolean,
    contentMargin: number,
    bottomInset: number,
    floatingFooterEnd: number | undefined,
  ) => ({
    padding: theme.spacing(4),
    paddingHorizontal: contentMargin,
    paddingBottom: floatingFooterEnd ?? (hasFooter ? 0 : theme.spacing(4) + bottomInset),
  }),
  // The pinned footer slot: sits outside the scrollable surface (a
  // `ScrollView` in scroll mode, a sibling `View` in plain mode — see
  // `screen.component.tsx`), inside the bottom safe-area edge, in both
  // branches. Its bottom padding is lifted clear of the floating native glass
  // tab bar by `bottomClearance` (the tab bar's measured height MINUS
  // whatever the enclosing `SafeAreaView` already reserves for the bottom
  // safe-area inset — the `SafeAreaView` reservation and this padding are two
  // separate layout boxes that both sit between the button and the screen's
  // true bottom edge, so `bottomClearance` must be only the REMAINDER, not
  // the tab bar's full height, or the two double-count the inset), plus
  // the `FOOTER_GAP_STEP` of visible breathing room on top of that clearance —
  // the exact, measured distance a footer button sits above the tab bar. Any
  // screen that manages its own bottom-clearance scrollable surface instead of
  // routing through this slot (e.g. Home's SectionList, via `bleedBottom`)
  // should add this same step for a consistent gap. Horizontal padding is the
  // content margin (`useContentMargin`); top padding stays at the base spacing step.
  //
  // A floating footer beside a side bar (`sideBarInset` set) ends exactly that far above the
  // window's bottom instead, in place of the gap and the clearance (the home-indicator inset).
  footer: (bottomClearance: number, contentMargin: number, sideBarInset: number | undefined) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: contentMargin,
    paddingBottom: sideBarInset ?? theme.spacing(FOOTER_GAP_STEP) + bottomClearance,
  }),
  // A floating footer (`floatingFooter`): the zero-height anchor takes the place of the pinned
  // footer in the flex column, so it ends where the pinned footer would have ended and the
  // SafeAreaView's padding is honoured on every side. Nothing is painted on either view.
  floatingFooterAnchor: {
    height: 0,
  },
  // Grows upward from the anchor's bottom edge over the scroll surface, as wide as the anchor.
  floatingFooter: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
  },
}));
