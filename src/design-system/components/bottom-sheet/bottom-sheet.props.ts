import type { ReactNode } from 'react';
import type { DimensionValue } from 'react-native';

/** The Modal transition used to present the sheet. */
type BottomSheetAnimation = 'fade' | 'slide';

export type BottomSheetProps = {
  /** Whether the sheet and its dismiss scrim are mounted and shown. */
  visible: boolean;
  /** Called on a tap on the scrim behind the sheet, or a hardware/gesture back. */
  onDismiss: () => void;
  /** The sheet's content, laid out in a bottom-anchored column. */
  children: ReactNode;
  /**
   * The inner column gap between the sheet's content rows, in `theme.spacing`
   * steps. This is content spacing, legitimately per-sheet (a dense checklist
   * wants less than a calendar-plus-actions sheet), so it stays a prop rather
   * than a shared constant. Defaults to 3.
   */
  gap?: number;
  /** The Modal transition. Defaults to `'fade'`. */
  animationType?: BottomSheetAnimation;
  /**
   * An optional cap on the sheet's height so a tall sheet scrolls its own
   * content (via an inner ScrollView) instead of growing past the viewport.
   * Left unset, the sheet sizes to its content.
   */
  maxHeight?: DimensionValue;
  /** A `testID` for the sheet card itself (its content container). */
  testID?: string;
  /** A `testID` for the dismiss scrim (e.g. a filter menu's `${id}-backdrop`). */
  backdropTestID?: string;
  /**
   * An accessibility label for the dismiss scrim. When provided, the scrim also
   * takes `accessibilityRole="button"` so it reads as a tappable dismiss target.
   */
  backdropAccessibilityLabel?: string;
};
