import type { ReactNode } from 'react';

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
   * An optional header node rendered INSIDE the same draggable region as the
   * grabber handle (the grabber pill on top, then this node), so a drag
   * anywhere across the header — not only on the small pill — drives the
   * sheet's drag-to-dismiss. `children` stay OUTSIDE that region, so a
   * scrollable body still scrolls freely without the Pan competing for its
   * touch. Defaults to `undefined`: a sheet that passes no `header` keeps the
   * exact grabber-only drag region it had before. Use it for a sheet whose
   * title/heading should double as drag surface (the Statistics trend-filter
   * sheet passes its `<Text variant="heading">` title here).
   */
  header?: ReactNode;
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
   * An optional STRICTER cap on the sheet's height, in pixels, for a sheet
   * that wants to scroll its own content sooner than the shared default.
   * `BottomSheet` itself always caps every sheet at 66% of the current
   * window height (`useWindowDimensions().height`, so it tracks rotation) —
   * that 66% cap is the absolute ceiling no sheet can exceed, applied here in
   * ONE owner rather than left for each call site to reproduce (and drift
   * on). Passing a smaller `maxHeight` only ever tightens the cap further; it
   * can never loosen it past 66%.
   */
  maxHeight?: number;
  /**
   * Whether the sheet wraps `children` in its own scrolling container so
   * content taller than the 66% cap scrolls instead of being clipped.
   * Defaults to `true` — the shared fix for every plain sheet (filter-menu,
   * date-field, the transaction-form category-override confirm) that used to
   * render no scroll container at all and simply got clipped at the cap.
   *
   * Set to `false` only when the sheet needs a pinned header/footer/actions
   * row that must stay OUTSIDE the scrollable region, or needs direct control
   * of its own `ScrollView` (a scroll-to-selection ref): date-range-field
   * (its Apply/Clear row), category-field (its scroll-to-selected-row ref
   * and heading), and icon-picker-modal (its Remove/Cancel header) each pass
   * `false` and render their own inner `ScrollView` around just the region
   * that should scroll — never BOTH the shared one and their own, which would
   * nest two same-axis `ScrollView`s.
   */
  scrollable?: boolean;
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
