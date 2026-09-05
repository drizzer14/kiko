import type { FC } from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { BoxProps } from './box.props';
import { styles } from './box.styles';

const Box: FC<BoxProps> = ({ children, style, background, padding, gap, direction, ...props }) => {
  const { theme } = useUnistyles();

  return (
    <View
      style={[
        styles.box,
        background !== undefined && { backgroundColor: theme.colors[background] },
        padding !== undefined && { padding: theme.spacing(padding) },
        gap !== undefined && { gap: theme.spacing(gap) },
        direction !== undefined && { flexDirection: direction },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
};

export default Box;
