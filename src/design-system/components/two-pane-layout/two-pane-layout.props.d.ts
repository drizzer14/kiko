import type { ReactNode } from 'react';
import type { LayoutMode } from '@kiko/display-regions';

export type TwoPaneLayoutProps = {
  companion: ReactNode;
  primary: ReactNode;
  // Pins the mode; without it the layout follows the window. A caller that waits for a pose
  // change to settle pins the mode it settled on, so a transient frame of another mode cannot
  // swap the panes out from under it.
  mode?: LayoutMode;
  // What the companion pane asks of a columns window; equal halves without it. The layout may
  // grant more (a list pane floor) and ignores it in rows and beside a fold.
  companionShare?: number;
};
