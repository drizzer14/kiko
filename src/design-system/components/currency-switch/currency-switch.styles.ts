import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // A compact segmented pill. Only the shape lives here; the selected/unselected
  // fill is a runtime theme color layered on at the call site (see the
  // component), so the transparent-unselected rationale stays next to its use.
  pill: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
