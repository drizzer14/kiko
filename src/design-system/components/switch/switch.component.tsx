import type { FC } from 'react';
import { Switch as RNSwitch } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';

import type { SwitchProps } from './switch.props';
import { styles } from './switch.styles';

const Switch: FC<SwitchProps> = ({ value, onValueChange, disabled = false, label, testID }) => {
  const { theme } = useUnistyles();

  const toggle = (
    <RNSwitch
      testID={testID}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      // RN's Switch only folds `disabled` into accessibilityState on Android; on
      // iOS the disabled state never reaches the accessibility tree. Set it here
      // so a disabled toggle is announced disabled (and testable) on both.
      accessibilityState={{ disabled }}
      trackColor={{ false: theme.colors.surfaceHigh, true: theme.colors.accent }}
      thumbColor={theme.colors.onAccent}
    />
  );

  if (label === undefined) {
    return toggle;
  }

  return (
    <Box direction="row" style={styles.row}>
      <Text variant="body">{label}</Text>

      {toggle}
    </Box>
  );
};

export default Switch;
