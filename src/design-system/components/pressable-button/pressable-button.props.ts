import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

export type PressableButtonProps = {
  onPress: () => void;
  backgroundColor: string;
  disabled?: boolean;
  alignSelf?: ViewStyle['alignSelf'];
  // Rendered before `children` in a horizontal row with a small gap (e.g. a
  // `Symbol`). Optional so existing text-only call sites are unaffected.
  icon?: ReactNode;
  children: ReactNode;
};
