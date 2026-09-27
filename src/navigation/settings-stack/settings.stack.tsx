import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import SystemScreen from '@kiko/screens/settings/system';
import SettingsScreen from '@kiko/screens/settings/settings';
import CategoriesScreen from '@kiko/screens/settings/categories';
import ExportDataScreen from '@kiko/screens/settings/export-data';
import ImportDataScreen from '@kiko/screens/settings/import-data';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { SettingsStackParamList } from '../types';
import { resetTabStackOnBlur } from '../reset-tab-stack-on-blur';

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

      <Stack.Screen
        name="ExportData"
        component={ExportDataScreen}
        options={{ title: t('settings.dataExport.title') }}
      />

      <Stack.Screen
        name="ImportData"
        component={ImportDataScreen}
        options={{ title: t('settings.dataImport.title') }}
      />
    </Stack.Navigator>
  );
};

export default SettingsStack;
