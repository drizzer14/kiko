import type { FC } from 'react';
import { helpTopicById } from '@kiko/help';
import { useTranslation } from 'react-i18next';
import HelpScreen from '@kiko/screens/settings/help';
import SystemScreen from '@kiko/screens/settings/system';
import SettingsScreen from '@kiko/screens/settings/settings';
import RemindersScreen from '@kiko/screens/settings/reminders';
import HelpTopicScreen from '@kiko/screens/settings/help-topic';
import CategoriesScreen from '@kiko/screens/settings/categories';
import ExportDataScreen from '@kiko/screens/settings/export-data';
import ImportDataScreen from '@kiko/screens/settings/import-data';
import ReminderFormScreen from '@kiko/screens/forms/reminder-form';
import CategoryFormScreen from '@kiko/screens/forms/category-form';
import CategoryDetailScreen from '@kiko/screens/settings/category-detail';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { SettingsStackParamList } from '../types';
import { resetTabStackOnBlur } from '../reset-tab-stack-on-blur';
import { largeTitleScreenOptions } from '../large-title-screen-options';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

/** The Settings tab's native stack, rooted at a large-title Settings screen. */
const SettingsStack: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack.Navigator screenOptions={largeTitleScreenOptions} screenListeners={resetTabStackOnBlur}>
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

      {/* The page sets its own title from the category's name, so it starts empty: the raw route
          name never shows while the category is still being read. */}
      <Stack.Screen
        name="CategoryDetail"
        component={CategoryDetailScreen}
        options={{ title: '' }}
      />

      <Stack.Screen
        name="CategoryForm"
        component={CategoryFormScreen}
        options={{ title: t('categoryForm.addTitle') }}
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

      <Stack.Screen
        name="Reminders"
        component={RemindersScreen}
        options={{ title: t('reminders.title') }}
      />

      <Stack.Screen
        name="ReminderForm"
        component={ReminderFormScreen}
        options={{ title: t('reminders.form.createTitle') }}
      />

      <Stack.Screen name="Help" component={HelpScreen} options={{ title: t('help.title') }} />

      <Stack.Screen
        name="HelpTopic"
        component={HelpTopicScreen}
        options={({ route }) => ({ title: t(helpTopicById(route.params.topicId).titleKey) })}
      />
    </Stack.Navigator>
  );
};

export default SettingsStack;
