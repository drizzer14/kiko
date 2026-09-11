import type { FC } from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { DividerProps } from './divider.props';
import { styles } from './divider.styles';

const Divider: FC<DividerProps> = ({ spacing = 0, style, testID }) => {
  const { theme } = useUnistyles();

  return (
    <View
      style={[styles.divider, { marginVertical: theme.spacing(spacing) }, style]}
      testID={testID}
    />
  );
};

export default Divider;
