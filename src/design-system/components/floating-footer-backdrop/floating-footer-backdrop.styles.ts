import { StyleSheet } from 'react-native-unistyles';

// The slot's own top padding (`spacing(4)` on the `footer` style in `screen.styles.ts`): the gap
// above the first button. The glass band starts below it, the fade fills it.
const FOOTER_TOP_PADDING_STEP = 4;

export const styles = StyleSheet.create((theme) => ({
  // Starts at the buttons' top and fills down to the bottom of the overlay.
  band: {
    position: 'absolute',
    top: theme.spacing(FOOTER_TOP_PADDING_STEP),
    left: 0,
    right: 0,
    bottom: 0,
  },
  // The slot's top padding, from the slot top to the band top; the Svg inside fills it.
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: theme.spacing(FOOTER_TOP_PADDING_STEP),
  },
}));
