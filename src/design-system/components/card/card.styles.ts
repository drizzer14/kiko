import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The ONE solid content-card surface (see `card.component.tsx`'s doc
  // comment for why content cards are flat, not glass, on this app's HIG
  // reading): the same `surface` token (`secondarySystemBackground`) the
  // Liquid Glass fallback path already used for a non-glass device, now the
  // single source of truth for every content card regardless of device. The
  // hairline `border` separator is the ONE separation mechanism (a defined
  // border per iOS 27's own content-layer convention), never a drop shadow —
  // and it is UNCONDITIONAL, not an opt-in prop, so no content card can drift
  // from another by omitting it.
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
}));
