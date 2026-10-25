import { createNavigationContainerRef } from '@react-navigation/native';

import type { TabParamList } from '../types';

// Lets code that runs outside any screen, such as a notification tap, navigate, and lets a
// screen read the root state across tabs (`getRootState`), which its own navigator cannot see.
export const navigationRef = createNavigationContainerRef<TabParamList>();
