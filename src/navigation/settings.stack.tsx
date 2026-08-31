import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import SettingsScreen from '../screens/settings/settings.screen';
import type { SettingsStackParamList } from './types';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

/** The Settings tab's native stack, rooted at a large-title Settings screen. */
const SettingsStack: FC = () => (
  <Stack.Navigator screenOptions={{ headerLargeTitle: true }}>
    <Stack.Screen name="Settings" component={SettingsScreen} />
  </Stack.Navigator>
);

export default SettingsStack;
