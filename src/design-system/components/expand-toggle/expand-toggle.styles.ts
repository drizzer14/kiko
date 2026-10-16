import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The "Show all" / "Show less" link: a self-aligned tap target sat under the list it expands,
  // padded vertically so the touch area clears the rows' gap. It reads as a caption-sized
  // accent link, not a filled button.
  toggle: {
    alignSelf: 'flex-start',
    paddingVertical: theme.spacing(1),
  },
  // The toggle's label + trailing disclosure chevron, centered on the same row so the glyph
  // reads as paired with the caption beside it.
  toggleContent: {
    alignItems: 'center',
  },
}));
