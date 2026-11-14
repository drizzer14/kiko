import { useCallback, useState } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import type { LayoutChangeEvent } from 'react-native';
import { REGULAR_BUTTON_HEIGHT } from '@kiko/design-system/regular-button-height';

import { FOOTER_GAP_STEP } from './screen.styles';
import { floatingFooterBottom } from './floating-footer-bottom';

type FloatingFooterHeight = {
  height: number;
  onLayout: (event: LayoutChangeEvent) => void;
};

/**
 * The height of a floating footer slot, which the scroll content pads its end by so the last row
 * stops at the footer's top edge. Measured by `onLayout` (the buttons can be one or two, and grow
 * with the text size). Until the first measure it is the slot of one regular button, so the common
 * single-button footer paints its first frame at the right padding with no jump.
 */
export const useFloatingFooterHeight = (
  bottomClearance: number,
  sideBarInset: number | undefined,
  safeAreaBottom: number,
): FloatingFooterHeight => {
  const { theme } = useUnistyles();
  const [measuredHeight, setMeasuredHeight] = useState<number | undefined>(undefined);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setMeasuredHeight(event.nativeEvent.layout.height),
    [],
  );
  const estimatedHeight =
    theme.spacing(4) +
    REGULAR_BUTTON_HEIGHT +
    (floatingFooterBottom({
      bottomClearance,
      safeAreaBottom,
      sideBarInset,
      footerGap: theme.spacing(FOOTER_GAP_STEP),
    }) -
      safeAreaBottom);

  return { height: measuredHeight ?? estimatedHeight, onLayout };
};
