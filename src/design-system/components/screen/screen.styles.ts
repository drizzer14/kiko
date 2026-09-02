import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  // The plain (non-scroll) branch's content container. When it owns the
  // screen's true bottom edge itself (no `footer`, no `bleedBottom` child),
  // its bottom padding is lifted clear of the floating native glass tab bar by
  // `bottomClearance` (the bar's measured height plus the bottom safe-area
  // inset, computed at the call site), plus the same base `theme.spacing(4)`
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
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: ownsClearance ? theme.spacing(4) + bottomClearance : theme.spacing(4),
  }),
  // The scroll-mode content container: no `flex: 1` (a ScrollView's content
  // container sizes to its content, not the viewport), same padding as the
  // non-scroll `content` above.
  scrollContent: {
    padding: theme.spacing(4),
  },
  // The pinned footer slot: sits outside the scrollable surface (a
  // `ScrollView` in scroll mode, a sibling `View` in plain mode — see
  // `screen.component.tsx`), inside the bottom safe-area edge, in both
  // branches. Its bottom padding is lifted clear of the floating native glass
  // tab bar by `bottomClearance` (the bar's measured height plus the bottom
  // safe-area inset, computed at the call site from the library hook), plus
  // one base `theme.spacing(4)` step of visible breathing room on top of that
  // clearance — this `spacing(4)` step is the ideal bottom gap: the exact,
  // measured distance a footer button sits above the tab bar. Any screen that
  // manages its own bottom-clearance scrollable surface instead of routing
  // through this slot (e.g. Home's SectionList, via `bleedBottom`) should add
  // this same base step for a consistent gap. Horizontal and top padding stay
  // at the base spacing step.
  footer: (bottomClearance: number) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: theme.spacing(4) + bottomClearance,
  }),
}));
