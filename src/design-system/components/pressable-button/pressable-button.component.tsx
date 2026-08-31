import type { FC } from 'react';
import { Pressable } from 'react-native';
import type { PressableButtonProps } from './pressable-button.props';
import { styles } from './pressable-button.styles';

const PressableButton: FC<PressableButtonProps> = ({
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

export default PressableButton;
