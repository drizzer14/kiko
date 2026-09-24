import { StyleSheet } from 'react-native-unistyles';

import { DISABLED_OPACITY } from '../../disabled-opacity';

// The segmented control's VISIBLE height — iOS's own UISegmentedControl reads
// noticeably shorter than a 44pt row (see segmented-control.component.tsx's
// SEGMENT_HIT_SLOP for how the 44pt HIG touch target is still met), the same
// visible-short/hitSlop-restored split `Button`'s own `small` size documents
// (`button.styles.ts`'s `SMALL_MIN_HEIGHT`).
const SEGMENT_MIN_HEIGHT = 36;

export const styles = StyleSheet.create((theme) => ({
  // The track: one elevation step above the screen background — the same
  // "elevation via translucent overlay" scale the OLED dark theme uses
  // elsewhere (see kiko-design-system's "Dark-only theme" section), so the
  // selected segment (one step further, `surfaceHigh`) reads as clearly
  // raised above it, mirroring real UISegmentedControl's fill-vs-selected-
  // segment contrast.
  track: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(1),
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SEGMENT_MIN_HEIGHT,
    borderRadius: theme.radii.sm,
  },
  segmentSelected: {
    backgroundColor: theme.colors.surfaceHigh,
  },
  // A read-only control (an edit form's uneditable value): dimmed with the
  // one shared disabled-pressable token so it reads as fixed while still
  // showing which segment is selected — never a fresh inline opacity (see
  // kiko-design-system's "Button" section on `DISABLED_OPACITY`).
  disabled: {
    opacity: DISABLED_OPACITY,
  },
}));
