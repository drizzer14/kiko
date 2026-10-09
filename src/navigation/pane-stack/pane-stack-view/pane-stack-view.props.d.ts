import type { ComponentProps } from 'react';
import type { LayoutMode } from '@kiko/display-regions';
import type { NativeStackView } from '@react-navigation/native-stack';

import type { PaneConfig } from '../pane-assignment';
import type { PaneStackState } from '../pane-router';

export type NativeStackViewProps = ComponentProps<typeof NativeStackView>;

export type PaneStackViewProps = Omit<NativeStackViewProps, 'state'> & {
  state: PaneStackState;
  paneConfig: PaneConfig;
  // The mode the navigator has settled on, which is not always the window's current one.
  mode: LayoutMode;
};
