import type { FC, ReactNode } from 'react';
import { Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

type ListRowProps = {
  onPress: () => void;
  children: ReactNode;
};

export const ListRow: FC<ListRowProps> = ({ onPress, children }) => {
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

const styles = StyleSheet.create(theme => ({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
