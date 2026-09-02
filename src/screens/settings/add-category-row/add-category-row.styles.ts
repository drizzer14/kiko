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
  // The form's header line: the icon-picker toggle beside the name field, both
  // vertically centered so the chip and the (unlabelled) input line up.
  header: {
    alignItems: 'center',
  },
  // The leading icon presented as a bordered, rounded chip so it reads as a
  // tappable control opening the icon picker — the border is the affordance.
  iconChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The name field grows to fill the row width beside the fixed icon toggle,
  // mirroring the inline rename field on the category rows above (see
  // categories.styles.ts `input`).
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(2),
    ...theme.typography.body,
  },
  // Each of the Cancel / Save actions takes an equal half of the action row.
  action: {
    flex: 1,
  },
}));
