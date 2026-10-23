import { useTabBarPlacement } from './use-tab-bar-placement';

/**
 * The one test for a pane whose native large title takes the content's margin: the tab bar is not
 * at the bottom, at the top or at a side (every regular iPad window and every Surface Duo pose
 * with a side bar). `PaneStackView` gives its stacks the content's margin on this value, so the
 * title starts where the content does. The content cap is a separate test: only a bar at the top
 * lifts it (`useIsTabBarAtTop`).
 */
export const useIsTabBarNotAtBottom = (): boolean => useTabBarPlacement() !== 'bottom';
