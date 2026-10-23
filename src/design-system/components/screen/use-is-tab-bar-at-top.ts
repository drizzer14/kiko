import { useTabBarPlacement } from './use-tab-bar-placement';

/**
 * The one test for a pane whose content is uncapped: the tab bar is at the top (every regular
 * iPad window, whatever its size). `useContentCap` lifts the cap on this value only; a pane with
 * a side bar stays capped. The native title's margin is a wider test (`useIsTabBarNotAtBottom`).
 */
export const useIsTabBarAtTop = (): boolean => useTabBarPlacement() === 'top';
