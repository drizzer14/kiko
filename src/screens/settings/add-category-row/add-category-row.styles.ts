import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The collapsed "Add category" affordance: a leading plus icon beside its
  // label, vertically centered. Its own card (the enclosing GlassSurface)
  // supplies padding and the bordered edge, so this only owns the row's
  // internal alignment.
  addRow: {
    alignItems: 'center',
  },
  // Each of the Cancel / Save actions takes an equal half of the action row.
  action: {
    flex: 1,
  },
}));
