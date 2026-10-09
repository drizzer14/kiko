import type { ComponentProps } from 'react';
import type { NativeStackView } from '@react-navigation/native-stack';

import type { PaneConfig } from '../pane-assignment';
import type { PaneStackState } from '../pane-router';

export type NativeStackViewProps = ComponentProps<typeof NativeStackView>;

export type PaneStackViewProps = Omit<NativeStackViewProps, 'state'> & {
  state: PaneStackState;
  paneConfig: PaneConfig;
};
