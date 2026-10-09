export type Pane = 'companion' | 'primary';

// A pane for each route key. A key without an entry takes the pane opposite to the route below it.
export type PaneMap = Readonly<Record<string, Pane | undefined>>;

export type RouteLike = {
  key: string;
  name: string;
  params?: Readonly<object | undefined>;
  // A route a pane shows only because nothing was tapped there. Folding drops it.
  isDefault?: boolean;
};

// What an empty pane shows: a screen the user did not tap.
export type PaneDefault = { name: string; params?: object; isDefault: true };

export type PaneConfig = {
  rootPane: Pane;
  companionDefault?: PaneDefault;
  primaryDefault?: PaneDefault;
};

export type VisibleRoutes<Route extends RouteLike> = {
  companion: Route | PaneDefault | null;
  primary: Route | PaneDefault | null;
};
