import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    padding: theme.spacing(4),
  },
  // The scroll-mode content container: no `flex: 1` (a ScrollView's content
  // container sizes to its content, not the viewport), same padding as the
  // non-scroll `content` above.
  scrollContent: {
    padding: theme.spacing(4),
  },
  // The pinned footer slot: sits outside the ScrollView, inside the bottom
  // safe-area edge. Its bottom padding is lifted clear of the floating native
  // glass tab bar by `bottomClearance` (the bar's measured height plus the
  // bottom safe-area inset, computed at the call site from the library hook),
  // so any footer action — every current and future one — stays reachable and
  // is never occluded by the bar. Horizontal and top padding stay at the base
  // spacing step.
  footer: (bottomClearance: number) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: theme.spacing(4) + bottomClearance,
  }),
}));
