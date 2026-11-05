import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The list is the screen's scroll view, a direct child of `Screen` (`bleedTop`), so iOS tracks
  // it for the large title.
  list: {
    flex: 1,
  },
  // The list owns the screen's padding: `spacing(4)` below the title, the content margin at the
  // sides, and the tab bar's clearance under the last line.
  listContent: (bottomClearance: number, contentMargin: number) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: contentMargin,
    paddingBottom: theme.spacing(4) + bottomClearance,
    gap: theme.spacing(2),
  }),
}));
