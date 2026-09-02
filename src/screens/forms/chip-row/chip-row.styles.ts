import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
