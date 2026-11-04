import { StyleSheet } from 'react-native-unistyles';

import { CELL_PADDING_UNITS } from './data-table.layout';

export const styles = StyleSheet.create((theme) => ({
  // The table fills the height its caller gives it: one vertical scroll holds caption and body.
  container: {
    flex: 1,
  },
  top: {
    gap: theme.spacing(3),
  },
  caption: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    paddingBottom: theme.spacing(2),
  },
  // Opaque, because the row sticks above the body rows scrolling under it.
  headerRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderBottomWidth: theme.layout.hairline,
    borderBottomColor: theme.colors.border,
  },
  // The header's own corner above the fixed column keeps the column's opaque ground and edge.
  headerCorner: {
    backgroundColor: theme.colors.surface,
    borderRightWidth: theme.layout.hairline,
    borderRightColor: theme.colors.border,
  },
  headerClip: {
    flex: 1,
    overflow: 'hidden',
  },
  // Follows the body's live horizontal offset on the UI thread, through a shared value.
  headerTrack: {
    flexDirection: 'row',
  },
  headerCell: {
    justifyContent: 'center',
    paddingHorizontal: theme.spacing(CELL_PADDING_UNITS),
    paddingVertical: theme.spacing(CELL_PADDING_UNITS),
  },
  headerText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  bodyRow: {
    flexDirection: 'row',
  },
  fixedColumn: {
    backgroundColor: theme.colors.surface,
    borderRightWidth: theme.layout.hairline,
    borderRightColor: theme.colors.border,
  },
  bodyScroll: {
    flex: 1,
  },
  fixedRow: {
    justifyContent: 'center',
    paddingHorizontal: theme.spacing(CELL_PADDING_UNITS),
    borderBottomWidth: theme.layout.hairline,
    borderBottomColor: theme.colors.border,
  },
  scrolledRow: {
    flexDirection: 'row',
    borderBottomWidth: theme.layout.hairline,
    borderBottomColor: theme.colors.border,
  },
  labelText: {
    ...theme.typography.body,
    color: theme.colors.textPrimary,
  },
  cell: {
    justifyContent: 'center',
    paddingHorizontal: theme.spacing(CELL_PADDING_UNITS),
  },
  sumColumn: {
    backgroundColor: theme.colors.sheetBackground,
  },
  // `Text`'s style Pick excludes `fontVariant`, so the cell text is a plain RN Text.
  cellText: {
    ...theme.typography.caption,
    color: theme.colors.textPrimary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  negativeText: {
    color: theme.colors.negative,
  },
  summaryText: {
    fontWeight: '700',
  },
  // Hidden twin of every text, laid out at its natural size only to read its width.
  measureLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    opacity: 0,
  },
  measureColumn: {
    alignItems: 'flex-start',
  },
}));
