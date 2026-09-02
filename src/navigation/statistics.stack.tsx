import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import StatisticsScreen from '../screens/statistics/statistics.screen';
import { resetTabStackOnBlur } from './reset-tab-stack-on-blur';
import type { StatisticsStackParamList } from './types';

const Stack = createNativeStackNavigator<StatisticsStackParamList>();

/** The Statistics tab's native stack, rooted at a large-title Statistics screen. */
const StatisticsStack: FC = () => (
  <Stack.Navigator screenOptions={{ headerLargeTitle: true }} screenListeners={resetTabStackOnBlur}>
    <Stack.Screen name="Statistics" component={StatisticsScreen} />
  </Stack.Navigator>
);

export default StatisticsStack;
