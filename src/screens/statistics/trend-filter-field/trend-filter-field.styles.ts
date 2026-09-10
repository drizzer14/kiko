import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The tappable filter chip: same bordered, filled chrome as the Accounts /
  // Categories / date-range controls so the filter row reads as one set. A
  // leading filter glyph sits before the applied-selection label.
  field: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
  },
  // The sheet's scrollable region (title + controls), sized to shrink to the
  // sheet's 66% cap — the Clear/Save row stays a sibling below it (see
  // date-range-field for the same pattern and why).
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: theme.spacing(4),
  },
  // One category multi-select row's tap area: rounded and inset so the selected
  // fill below reads as a contained row rather than an edge-to-edge band. The
  // row's own layout (check slot, icon slot, label) lives on `optionInner`.
  option: {
    paddingVertical: theme.spacing(1),
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radii.sm,
  },
  // The selected row's fill: a raised surface one level above the sheet's
  // grouped base, so a chosen category reads as clearly selected — distinct from
  // an unselected transparent row AND from the solid-accent Save pill.
  optionSelected: {
    backgroundColor: theme.colors.surfaceHigh,
  },
  // The row's inner layout: a fixed-width check slot, an icon slot, then the
  // label. Mirrors the filter-menu row so the two pickers read identically.
  optionInner: {
    alignItems: 'center',
  },
  check: {
    width: theme.spacing(5),
    alignItems: 'center',
  },
  icon: {
    width: theme.spacing(5),
    alignItems: 'center',
  },
  // The Clear/Save action row, pinned to the trailing edge below the scroll
  // region so both actions stay reachable regardless of scroll position.
  actions: {
    justifyContent: 'flex-end',
  },
}));
