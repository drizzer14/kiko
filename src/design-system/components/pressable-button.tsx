import type { FC, ReactNode } from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

type PressableButtonProps = {
  onPress: () => void;
  backgroundColor: string;
  disabled?: boolean;
  alignSelf?: ViewStyle['alignSelf'];
  children: ReactNode;
};

export const PressableButton: FC<PressableButtonProps> = ({
  onPress,
  backgroundColor,
  disabled,
  alignSelf,
  children,
}) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    disabled={disabled}
    style={[styles.button, { backgroundColor }, alignSelf !== undefined && { alignSelf }]}
  >
    {children}
  </Pressable>
);

const styles = StyleSheet.create(theme => ({
  button: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
