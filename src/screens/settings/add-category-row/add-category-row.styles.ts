import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The collapsed "Add category" affordance: a leading plus icon beside its
  // label, vertically centered. Its own card (the enclosing GlassSurface)
  // supplies padding and the bordered edge, so this only owns the row's
  // internal alignment.
  addRow: {
    alignItems: 'center',
  },
  // The Cancel / Save action row: both buttons hug their own content at the
  // trailing edge (matching the date-range and trend-filter sheet rows), with
  // the compact Cancel and the regular Save vertically centered against each
  // other. This replaces the old equal-halves layout, which left the compact
  // Cancel pinned to the left of its half with a gap to its right.
  actions: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
}));
