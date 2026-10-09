import { createContext, useContext } from 'react';
import { useIsFocused, useRoute } from '@react-navigation/native';

/** The route on top of the primary pane: what a list beside it shows as selected. */
export type PrimaryPaneRoute = {
  name: string;
  params: object | undefined;
  // Shown because nothing was tapped there, not because the user chose it.
  isDefault: boolean;
};

type PaneVisibility = {
  isTabFocused: boolean;
  // The route on top of each pane. Both are on screen at once, though only one is the focused
  // route of the stack.
  visibleKeys: ReadonlySet<string>;
  // Null while the primary pane has neither a route nor a default.
  primaryRoute: PrimaryPaneRoute | null;
};

// Null in one pane, where the focused route is the only visible one.
export const PaneVisibilityContext = createContext<PaneVisibility | null>(null);

/**
 * Whether the calling screen is on screen right now. In two panes that is the route on top of
 * either pane while the tab is focused; the stack's focused route would hide the other pane's
 * screen from a data refresh. In one pane it is `useIsFocused`.
 */
export const useIsScreenVisible = (): boolean => {
  const { key } = useRoute();
  const isFocused = useIsFocused();
  const visibility = useContext(PaneVisibilityContext);

  return visibility === null
    ? isFocused
    : visibility.isTabFocused && visibility.visibleKeys.has(key);
};

/**
 * The route on top of the primary pane, for a list in the companion pane to mark as selected.
 * Null in one pane, and while the primary pane shows nothing.
 */
export const usePrimaryPaneRoute = (): PrimaryPaneRoute | null =>
  useContext(PaneVisibilityContext)?.primaryRoute ?? null;
