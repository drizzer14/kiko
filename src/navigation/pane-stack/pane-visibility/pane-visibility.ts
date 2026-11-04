import { createContext, useContext } from 'react';
import { useIsFocused, useRoute } from '@react-navigation/native';

/**
 * The first route of the detail pane: the page the list opened, which a list beside it shows as
 * selected while deeper steps cover it.
 */
export type DetailPaneRoute = {
  key: string;
  name: string;
  params: object | undefined;
  // Shown because nothing was tapped there, not because the user chose it.
  isDefault: boolean;
};

type PaneVisibility = {
  isTabFocused: boolean;
  // The route on top of each pane. Both are on screen at once, though only one is the focused
  // route of the stack; except while a pane takes the whole window, when it is that pane's alone.
  visibleKeys: ReadonlySet<string>;
  // Null while the detail pane has neither a route nor a default.
  detailRoute: DetailPaneRoute | null;
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
 * The first route of the detail pane, for the list beside it to mark as selected. Null in one
 * pane, and while the detail pane shows nothing.
 */
export const useDetailPaneRoute = (): DetailPaneRoute | null =>
  useContext(PaneVisibilityContext)?.detailRoute ?? null;

/**
 * A string param of a route, when the route is the one named: what a list reads off the detail
 * pane's first route to know which row it shows.
 */
export const detailParamOf = (
  route: Pick<DetailPaneRoute, 'name' | 'params'> | null,
  name: string,
  param: string,
): string | undefined => {
  const value =
    route?.name === name
      ? (route.params as Record<string, unknown> | undefined)?.[param]
      : undefined;

  return typeof value === 'string' ? value : undefined;
};
