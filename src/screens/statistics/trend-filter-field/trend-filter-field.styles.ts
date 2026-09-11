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
  // The manual-mode section (its "Categories" header + the scrollable list),
  // sized to SHRINK inside the sheet's 66% cap so only this list scrolls while
  // the sheet title above and the Clear/Save row below stay fixed.
  manualSection: {
    flexShrink: 1,
  },
  // The manual list's grouped GlassSurface card must shrink WITH its section so
  // the scroll region below it stays bounded under the sheet's 66% height cap;
  // without this the card would take its full content height and nothing would
  // scroll. The card's own `overflow: hidden` clips the list to its corners.
  manualGroup: {
    flexShrink: 1,
  },
  // The manual category list's own scroll region, shrinking to the space the
  // fixed header + action row leave (see date-range-field for the same pattern).
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: theme.spacing(1),
  },
  // One category multi-select row's tap area: rounded and inset so the selected
  // fill reads as a contained row rather than an edge-to-edge band, holding the
  // 44pt HIG minimum height so each row is a comfortable tap target. The row's
  // own layout (check slot, icon slot, label) lives on `optionInner`.
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // The selected row's fill: the FILLED accent surface — the app's standard
  // selection vocabulary (the OptionPills / ChipRow selected pill) — so a chosen
  // category reads unambiguously against the low-contrast sheet background, with
  // the row's onAccent label/icon/checkmark carrying the contrast on top of it.
  optionSelected: {
    backgroundColor: theme.colors.accent,
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
