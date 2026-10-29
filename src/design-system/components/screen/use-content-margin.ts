import { useUnistyles } from 'react-native-unistyles';

import { useTabBarPlacement } from './use-tab-bar-placement';

// The steps of the theme's spacing that a screen pads its content's sides by.
const CONTENT_MARGIN_STEP = 4;
const SIDE_BAR_CONTENT_MARGIN_STEP = 5;

/**
 * The margin a screen pads its content's sides by, and the one a native large title and bar items
 * are told (`PaneStackView`), so the title and the content line up. A side bar (the Surface Duo
 * poses) widens it, because the title there starts 20 pt in; everywhere else it is the base step.
 */
export const useContentMargin = (): number => {
  const { theme } = useUnistyles();
  const placement = useTabBarPlacement();

  return theme.spacing(placement === 'side' ? SIDE_BAR_CONTENT_MARGIN_STEP : CONTENT_MARGIN_STEP);
};
