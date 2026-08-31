import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { ListRowProps } from './list-row.props';
import { styles } from './list-row.styles';

const ListRow: FC<ListRowProps> = ({ onPress, children }) => {
  const { theme } = useUnistyles();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.row, { backgroundColor: theme.colors.surface }]}
    >
      {children}
    </Pressable>
  );
};

export default ListRow;
