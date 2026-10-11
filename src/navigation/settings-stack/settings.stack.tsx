import type { FC } from 'react';
import { helpTopicById } from '@kiko/help';
import { useTranslation } from 'react-i18next';
import HelpScreen from '@kiko/screens/settings/help';
import SystemScreen from '@kiko/screens/settings/system';
import SettingsScreen from '@kiko/screens/settings/settings';
import RemindersScreen from '@kiko/screens/settings/reminders';
import HelpTopicScreen from '@kiko/screens/settings/help-topic';
import CategoriesScreen from '@kiko/screens/settings/categories';
import AccountFormScreen from '@kiko/screens/forms/account-form';
import HoldingFormScreen from '@kiko/screens/forms/holding-form';
import ExportDataScreen from '@kiko/screens/settings/export-data';
import ImportDataScreen from '@kiko/screens/settings/import-data';
import ReminderFormScreen from '@kiko/screens/forms/reminder-form';
import TransactionFormScreen from '@kiko/screens/forms/transaction-form';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TransactionTemplatesScreen from '@kiko/screens/settings/transaction-templates';

import {
  accountFormOptions,
  holdingFormOptions,
  restoreDefaultAnimationOfSwappedForm,
} from '../swapped-form-options';
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

      <Stack.Screen
        name="TransactionTemplates"
        component={TransactionTemplatesScreen}
        options={{ title: t('transactionTemplates.title') }}
      />

      {/* The template forms, and the create forms their empty holding picker opens: they sit
          here, not behind a switch to the Accounts tab, which would reset this stack and drop
          the form's draft (as in the Home stack). */}
      <Stack.Screen
        name="TransactionForm"
        component={TransactionFormScreen}
        options={{ headerShown: true, ...largeTitleScreenOptions }}
      />

      <Stack.Screen
        name="AccountForm"
        component={AccountFormScreen}
        listeners={restoreDefaultAnimationOfSwappedForm}
        options={({ route }) => ({
          ...accountFormOptions(t, route),
          headerShown: true,
          ...largeTitleScreenOptions,
        })}
      />

      <Stack.Screen
        name="HoldingForm"
        component={HoldingFormScreen}
        listeners={restoreDefaultAnimationOfSwappedForm}
        options={({ route }) => ({
          ...holdingFormOptions(t, route),
          headerShown: true,
          ...largeTitleScreenOptions,
        })}
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
