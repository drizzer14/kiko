import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  // The compact chip look at every label step: its visible height sits BELOW
  // the 44pt HIG floor on purpose, mirroring Button's `small` size
  // (`SMALL_MIN_HEIGHT` in button.styles.ts, also 34). The component restores
  // the 44pt tap target with `hitSlop` (`CHIP_HIT_SLOP`,
  // chip-row.component.tsx), never with a taller visual.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    minHeight: 34,
    paddingVertical: theme.spacing(1),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
