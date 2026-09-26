import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import StatisticsScreen from '@kiko/screens/statistics/statistics.screen';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { StatisticsStackParamList } from '../types';
import { resetTabStackOnBlur } from '../reset-tab-stack-on-blur';

const Stack = createNativeStackNavigator<StatisticsStackParamList>();

/** The Statistics tab's native stack, rooted at a large-title Statistics screen. */
const StatisticsStack: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      screenOptions={{ headerLargeTitle: true }}
      screenListeners={resetTabStackOnBlur}
    >
      <Stack.Screen
        name="Statistics"
        component={StatisticsScreen}
        options={{ title: t('statistics.title') }}
      />
    </Stack.Navigator>
  );
};

export default StatisticsStack;
