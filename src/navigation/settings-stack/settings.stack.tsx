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

import type { SettingsStackParamList } from '../types';
import { createPaneStackNavigator } from '../pane-stack';
import { resetTabStackOnBlur } from '../reset-tab-stack-on-blur';
import { largeTitleScreenOptions } from '../large-title-screen-options';

const Stack = createPaneStackNavigator<SettingsStackParamList>();

// The menu is the root and takes the companion pane; what it opens takes the primary pane, which
// shows Categories until something else opens there.
const PANE_CONFIG = {
  rootPane: 'companion',
  primaryDefault: { name: 'Categories', isDefault: true },
} as const;

/** The Settings tab's native stack, rooted at a large-title Settings screen. */
const SettingsStack: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      paneConfig={PANE_CONFIG}
      screenOptions={largeTitleScreenOptions}
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
