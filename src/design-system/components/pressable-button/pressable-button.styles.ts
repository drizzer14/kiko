import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  button: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // Only used when an `icon` is passed, to lay it out next to the label.
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  // The owned label (from the `label` prop): title-cased once, here, so every
  // call site passing a sentence-case label reads consistently — mirroring the
  // primary `Button`'s label treatment.
  label: {
    textTransform: 'capitalize',
  },
}));
