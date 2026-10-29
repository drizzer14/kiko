import { useTabBarPlacement } from './use-tab-bar-placement';

/**
 * The one test for a split pane whose native large title takes the content's margin: the tab bar
 * is not at the bottom, at the top or at a side (every regular iPad window and every Surface Duo
 * pose with a side bar). `PaneStackView` gives its split panes the content's margin
 * (`useContentMargin`: 16 pt, 20 pt under a side bar) on this value, so the title starts where the
 * content does. A single pane takes it only under a side bar (the Duo outer pose), which
 * `PaneStackView` reads from the placement; a bottom bar keeps UIKit's margin. The content cap is
 * a separate test: only a bar at the top lifts it (`useIsTabBarAtTop`).
 */
export const useIsTabBarNotAtBottom = (): boolean => useTabBarPlacement() !== 'bottom';
