import { useTabBarPlacement } from './use-tab-bar-placement';

/**
 * The one test for a pane whose content and native large title share the content's margin: the
 * tab bar is at the top (every regular iPad window, whatever its size). `useContentCap` leaves
 * such a pane uncapped and `PaneStackView` gives its stacks the content's margin on this same
 * value, so the title and the content start at the same x.
 */
export const useIsTabBarAtTop = (): boolean => useTabBarPlacement() === 'top';
