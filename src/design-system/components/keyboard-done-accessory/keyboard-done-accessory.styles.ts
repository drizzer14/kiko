import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create({
  // The InputAccessoryView host: the ONLY styling on the native Done accessory.
  // It right-aligns the plain system `<Button>` above the keyboard (matching
  // iOS's own trailing placement); the button keeps its default system look,
  // with no custom fill, color, or weight.
  accessoryContainer: {
    alignItems: 'flex-end',
  },
});
