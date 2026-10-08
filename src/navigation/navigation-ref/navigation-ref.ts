import { createNavigationContainerRef } from '@react-navigation/native';

import type { TabParamList } from '../types';

// Lets code that runs outside any screen, such as a notification tap, navigate.
export const navigationRef = createNavigationContainerRef<TabParamList>();
