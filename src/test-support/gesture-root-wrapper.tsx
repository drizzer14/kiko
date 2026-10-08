import type { FC, ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// A GestureDetector must mount under a GestureHandlerRootView, so any test
// that exercises one needs this wrapper (the app supplies one at its root in
// production).
const GestureRootWrapper: FC<{ children: ReactNode }> = ({ children }) => {
  return <GestureHandlerRootView>{children}</GestureHandlerRootView>;
};

export default GestureRootWrapper;
