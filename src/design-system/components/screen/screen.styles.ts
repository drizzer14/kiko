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
const FOOTER_GAP_STEP = 4;

export const styles = StyleSheet.create((theme) => ({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
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
  // and top padding stay at the base spacing step regardless.
  content: (ownsClearance: boolean, bottomClearance: number) => ({
    flex: 1,
    // A large-title `bleedTop` screen never reaches this wrapper — it renders
    // its scrollable child directly under the SafeAreaView (see
    // `screen.component.tsx`) so the child, not this padded View, is the scroll
    // view iOS tracks for the large-title collapse. So this wrapper always keeps
    // the base top padding for the headerless/non-scrolling screens that DO use
    // it.
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: ownsClearance
      ? theme.spacing(FOOTER_GAP_STEP) + bottomClearance
      : theme.spacing(4),
  }),
  // The scroll-mode content container: no `flex: 1` by default (a
  // ScrollView's content container sizes to its content, not the viewport),
  // same base padding as the non-scroll `content` above. When a `footer` sits
  // below it (outside the ScrollView, as a sibling — see
  // `screen.component.tsx`), this container drops its own bottom padding so
  // the footer's own `paddingTop: theme.spacing(FOOTER_GAP_STEP)` below is the
  // ONE gap above the footer button, instead of both adding
  // `theme.spacing(FOOTER_GAP_STEP)` back to back — the doubled,
  // disproportionate gap feedback flagged on a short unscrolled form (e.g.
  // deposit-edit), since the two views are adjacent siblings with no shared
  // box to collapse the stacked padding. With no `footer`, this container
  // legitimately owns the scroll content's own trailing edge, so it keeps the
  // base bottom padding.
  //
  // `fillHeight` (e.g. Settings' bottom-anchored About footer) is the one
  // opt-in exception: it gives the container `flexGrow: 1` so a `flex: 1`
  // spacer child among the scroll content can actually push trailing content
  // down to fill a short viewport (without it the spacer collapses to 0
  // height, since the container never grows past its content). Bottom-pinned
  // content then needs the SAME `bottomClearance` reservation the plain
  // branch's `content` above gives its own true-bottom edge, or it lands
  // hidden behind the floating glass tab bar — mirrored here rather than
  // reused because that branch's padding is unconditional flex-column
  // padding, not a ScrollView content-container padding. `hasFooter` ALWAYS
  // wins over `fillHeight` for the bottom padding: the pinned footer slot
  // already owns the clearance/gap below it, so stacking `fillHeight`'s own
  // reservation on top would double the gap the `hasFooter` branch exists to
  // prevent — a screen that passes both `footer` and `fillHeight` still gets
  // the doubled-gap fix, not a footgun. `flexGrow: 1` itself still applies
  // whenever `fillHeight` is set, independent of `hasFooter` — growing the
  // container is orthogonal to who owns the bottom padding. Every other
  // `scroll` screen leaves `fillHeight` unset, so this branch never changes
  // their styling.
  scrollContent: (hasFooter: boolean, fillHeight: boolean, bottomClearance: number) => {
    let paddingBottom = theme.spacing(4);

    if (hasFooter) {
      paddingBottom = 0;
    } else if (fillHeight) {
      paddingBottom = theme.spacing(FOOTER_GAP_STEP) + bottomClearance;
    }

    return {
      padding: theme.spacing(4),
      paddingBottom,
      ...(fillHeight && { flexGrow: 1 }),
    };
  },
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
  // should add this same step for a consistent gap. Horizontal and top padding
  // stay at the base spacing step.
  footer: (bottomClearance: number) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: theme.spacing(FOOTER_GAP_STEP) + bottomClearance,
  }),
}));
