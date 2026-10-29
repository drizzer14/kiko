import { useUnistyles } from 'react-native-unistyles';
import { usePaneContext } from '@kiko/design-system/pane-context';

import { useTabBarPlacement } from './use-tab-bar-placement';

// The steps of the theme's spacing that a screen pads its content's sides by.
const CONTENT_MARGIN_STEP = 4;
const SPLIT_SIDE_BAR_CONTENT_MARGIN_STEP = 5;

/**
 * The margin a screen pads its content's sides by, and the one a native large title and bar items
 * are told (`PaneStackView`), so the title and the content line up. A split pane under a side bar
 * (the Surface Duo inner landscape pose) widens it, because the title there starts 20 pt in;
 * everywhere else, the folded Duo outer's single stack included, it is the base step. `isSplit` is
 * the settled split: `PaneStackView` passes its own mode, a screen reads its pane context through
 * `useContentMargin`.
 */
export const useContentMarginFor = (isSplit: boolean): number => {
  const { theme } = useUnistyles();
  const placement = useTabBarPlacement();

  return theme.spacing(
    isSplit && placement === 'side' ? SPLIT_SIDE_BAR_CONTENT_MARGIN_STEP : CONTENT_MARGIN_STEP,
  );
};

/** The content margin of the pane this screen is in, or of the single stack outside any pane. */
export const useContentMargin = (): number => useContentMarginFor(usePaneContext() !== null);
