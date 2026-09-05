import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';

import CategoriesScreen from '../screens/settings/categories.screen';
import SettingsScreen from '../screens/settings/settings.screen';

import { resetTabStackOnBlur } from './reset-tab-stack-on-blur';
import type { SettingsStackParamList } from './types';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

/** The Settings tab's native stack, rooted at a large-title Settings screen. */
const SettingsStack: FC = () => (
  <Stack.Navigator screenOptions={{ headerLargeTitle: true }} screenListeners={resetTabStackOnBlur}>
    <Stack.Screen name="Settings" component={SettingsScreen} />
    <Stack.Screen name="Categories" component={CategoriesScreen} />
  </Stack.Navigator>
);

export default SettingsStack;
