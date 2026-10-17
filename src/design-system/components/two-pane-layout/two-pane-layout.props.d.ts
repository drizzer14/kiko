import type { ReactNode } from 'react';
import type { LayoutMode } from '@kiko/display-regions';
import type { PaneName } from '@kiko/design-system/pane-context';

export type TwoPaneLayoutProps = {
  companion: ReactNode;
  primary: ReactNode;
  // Pins the mode; without it the layout follows the window. A caller that waits for a pose
  // change to settle pins the mode it settled on, so a transient frame of another mode cannot
  // swap the panes out from under it.
  mode?: LayoutMode;
  // The pane that gets the wider share of a wide columns window (a tab's list pane or its detail
  // pane); without it the panes stay equal halves.
  wideSlot?: PaneName;
};
