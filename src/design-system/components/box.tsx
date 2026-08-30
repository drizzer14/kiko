import type { FC, ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export type BoxBackground = 'background' | 'surface' | 'surfaceHigh';

export type BoxProps = ViewProps & {
  children?: ReactNode;
  background?: BoxBackground;
  padding?: number;
  gap?: number;
};

export const Box: FC<BoxProps> = ({ children, style, background, padding, gap, ...rest }) => {
  const { theme } = useUnistyles();

  return (
    <View
      style={[
        styles.box,
        background !== undefined && { backgroundColor: theme.colors[background] },
        padding !== undefined && { padding: theme.spacing(padding) },
        gap !== undefined && { gap: theme.spacing(gap) },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create(() => ({
  box: {
    backgroundColor: 'transparent',
  },
}));
