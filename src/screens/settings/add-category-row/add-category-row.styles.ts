import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The collapsed "Add category" affordance: a leading plus icon beside its
  // label, vertically centered, matching the category rows above it. A top
  // hairline divides it from the last category row so the two do not read as
  // one entity.
  addRow: {
    alignItems: 'center',
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  // The expanded inline form container, with the same top hairline as the
  // collapsed row so the form stays visually separated from the category list.
  form: {
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  // Each of the Cancel / Save actions takes an equal half of the action row.
  action: {
    flex: 1,
  },
}));
