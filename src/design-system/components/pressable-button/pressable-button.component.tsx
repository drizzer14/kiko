import type { FC } from 'react';
import { Pressable, View } from 'react-native';
import Text from '../text';
import type { PressableButtonProps } from './pressable-button.props';
import { styles } from './pressable-button.styles';

const PressableButton: FC<PressableButtonProps> = ({
  onPress,
  backgroundColor,
  disabled,
  alignSelf,
  icon,
  label,
  children,
}) => {
  // The button owns its label styling when given a plain-text `label` (title-
  // cased), and otherwise renders whatever `children` the caller passes (used
  // where the label needs styling the button does not own — see the props).
  const content =
    label !== undefined ? (
      <Text variant="body" style={styles.label}>
        {label}
      </Text>
    ) : (
      children
    );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { backgroundColor }, alignSelf !== undefined && { alignSelf }]}
    >
      {icon === undefined ? (
        content
      ) : (
        <View style={styles.content}>
          {icon}

          {content}
        </View>
      )}
    </Pressable>
  );
};

export default PressableButton;
