import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import CategoriesScreen from '../screens/settings/categories.screen';
import SettingsScreen from '../screens/settings/settings.screen';
import SystemScreen from '../screens/settings/system.screen';

import { resetTabStackOnBlur } from './reset-tab-stack-on-blur';
import type { SettingsStackParamList } from './types';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

/** The Settings tab's native stack, rooted at a large-title Settings screen. */
const SettingsStack: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      screenOptions={{ headerLargeTitle: true }}
      screenListeners={resetTabStackOnBlur}
    >
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t('settings.title') }}
      />
      <Stack.Screen
        name="System"
        component={SystemScreen}
        options={{ title: t('settings.system') }}
      />
      <Stack.Screen
        name="Categories"
        component={CategoriesScreen}
        options={{ title: t('settings.categories') }}
      />
    </Stack.Navigator>
  );
};

export default SettingsStack;
