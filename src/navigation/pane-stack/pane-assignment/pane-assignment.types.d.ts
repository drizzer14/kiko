import type { PaneName } from '@kiko/design-system/pane-context';

import type { Pane } from './pane-assignment';

// A pane for each route key. A key without an entry takes the root pane when its route is the
// root, and the detail pane (the root pane's opposite) for any other route.
export type PaneMap = Readonly<Record<string, Pane | undefined>>;

export type RouteLike = {
  key: string;
  name: string;
  params?: Readonly<object | undefined>;
  // A route a pane shows only because nothing was tapped there. Folding drops it.
  isDefault?: boolean;
  // A default that only says there is nothing to show yet. Opening a screen from it leaves it a
  // default, so it is replaced once there is something to show and a fold drops it.
  isPlaceholder?: boolean;
};

// What an empty pane shows: a screen the user did not tap.
export type PaneDefault = { name: string; params?: object; isDefault: true };

export type PaneConfig = {
  rootPane: Pane;
  companionDefault?: PaneDefault;
  primaryDefault?: PaneDefault;
  // The pane this tab gives the wider share on a wide window.
  wideSlot?: PaneName;
};
