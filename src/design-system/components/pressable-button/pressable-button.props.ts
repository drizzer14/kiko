import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

export type PressableButtonProps = {
  onPress: () => void;
  backgroundColor: string;
  disabled?: boolean;
  alignSelf?: ViewStyle['alignSelf'];
  children: ReactNode;
};
