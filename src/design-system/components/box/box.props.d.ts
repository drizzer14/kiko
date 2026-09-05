import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

type BoxBackground = 'background' | 'surface' | 'surfaceHigh';

type BoxDirection = 'row' | 'column';

export type BoxProps = ViewProps & {
  children?: ReactNode;
  background?: BoxBackground;
  padding?: number;
  gap?: number;
  direction?: BoxDirection;
};
