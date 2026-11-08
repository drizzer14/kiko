import { StyleSheet } from 'react-native-unistyles';

import { CELL_PADDING_UNITS } from './data-table.layout';

export const styles = StyleSheet.create((theme) => ({
  // The table fills the height its caller gives it: one vertical scroll holds caption and body.
  container: {
    flex: 1,
  },
  // Grows to the scroll's height, so the empty content can fill what the top content leaves.
  scrollContent: {
    flexGrow: 1,
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
  // The rows fill the room beside the fixed column even when every column fits, so a band runs to
  // the table's right edge.
  bodyScrollContent: {
    flexGrow: 1,
  },
  bodyContent: {
    flexGrow: 1,
  },
  // Translucent, so it lies over the opaque `surface` of the fixed column and over the screen's
  // background under the scrolled cells alike.
  bandedRow: {
    backgroundColor: theme.colors.rowBand,
  },
  // One line per column edge, drawn over the track outside the cells' layout: a border would take
  // the hairline from the text's room, and the measured column width would not hold the amount on
  // one line. The caller sets `left`.
  columnSeparator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: theme.layout.hairline,
    backgroundColor: theme.colors.border,
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
  // Translucent, so a banded row's band shows through the sum columns as through the months.
  sumColumn: {
    backgroundColor: theme.colors.sumTint,
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
