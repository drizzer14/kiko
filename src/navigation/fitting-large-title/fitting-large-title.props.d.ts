import type { ReactNode } from 'react';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export type FittingLargeTitleProps = {
  navigation: { setOptions: (options: NativeStackNavigationOptions) => void };
  // The screen's merged options, every `setOptions` override included.
  options: NativeStackNavigationOptions;
  children: ReactNode;
};
