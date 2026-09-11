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
  // The Clear/Save action row, pinned to the trailing edge below the scroll
  // region so both actions stay reachable regardless of scroll position.
  actions: {
    justifyContent: 'flex-end',
  },
}));
