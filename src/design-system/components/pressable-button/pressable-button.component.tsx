import type { FC } from 'react';
import { Pressable, View } from 'react-native';
import type { PressableButtonProps } from './pressable-button.props';
import { styles } from './pressable-button.styles';

const PressableButton: FC<PressableButtonProps> = ({
  onPress,
  backgroundColor,
  disabled,
  alignSelf,
  icon,
  children,
}) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    disabled={disabled}
    style={[styles.button, { backgroundColor }, alignSelf !== undefined && { alignSelf }]}
  >
    {icon === undefined ? (
      children
    ) : (
      <View style={styles.content}>
        {icon}
        {children}
      </View>
    )}
  </Pressable>
);

export default PressableButton;
