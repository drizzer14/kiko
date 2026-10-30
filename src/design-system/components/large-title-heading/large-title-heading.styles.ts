import { StyleSheet } from 'react-native-unistyles';

// Both scrollables that host the heading (`Screen`'s scroll mode and a bleed-top list) pad their
// first child by this step, so the heading's bottom edge is its height plus the padding.
export const HOST_TOP_PADDING_STEP = 4;

// Where the right pane's native in-row title sits on the Surface Duo (iOS 27.2, measured at
// rest). The bar is 58 pt tall from window y 24, so the content starts at window y 82; the title
// control starts at window y 27.67.
const IN_ROW_CONTENT_TOP = 82;
const IN_ROW_TITLE_TOP = 27.67;

export const styles = StyleSheet.create((theme) => ({
  heading: {
    marginBottom: theme.spacing(4),
  },
  // Takes no layout room, so the content starts where it does under the native in-row bar, and
  // sits where the host's padding starts the first child: the heading is placed against it.
  inRowSlot: {
    height: 0,
  },
  // The title row of the bar, in the scroll content: that content starts at the bar's bottom edge
  // at rest, and the slot is the host's top padding below its own top edge. The left and right are
  // the slot's, which already sits at the content margin on both sides.
  inRowHeading: {
    position: 'absolute',
    top: IN_ROW_TITLE_TOP - IN_ROW_CONTENT_TOP - theme.spacing(HOST_TOP_PADDING_STEP),
    left: 0,
    right: 0,
  },
}));
