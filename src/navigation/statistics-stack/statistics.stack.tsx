import type { FC } from 'react';
import HomeScreen from '@kiko/screens/home';
import { useTranslation } from 'react-i18next';
import StatisticsScreen from '@kiko/screens/statistics';
import AccountFormScreen from '@kiko/screens/forms/account-form';
import HoldingFormScreen from '@kiko/screens/forms/holding-form';
import TransactionFormScreen from '@kiko/screens/forms/transaction-form';

import {
  accountFormOptions,
  holdingFormOptions,
  restoreDefaultAnimationOfSwappedForm,
} from '../swapped-form-options';
import { createPaneStackNavigator } from '../pane-stack';
import type { StatisticsStackParamList } from '../types';
import { fittingLargeTitleLayout } from '../fitting-large-title';
import { resetTabStackOnBlur } from '../reset-tab-stack-on-blur';
import { largeTitleScreenOptions } from '../large-title-screen-options';

const Stack = createPaneStackNavigator<StatisticsStackParamList>();

// Statistics is what the outer display shows, so it takes the primary pane; Home fills the
// companion until something else opens there.
const PANE_CONFIG = {
  rootPane: 'primary',
  companionDefault: { name: 'Home', isDefault: true },
} as const;

/**
 * The Statistics tab's native stack, rooted at a large-title Statistics screen. Home and the
 * Transaction form are registered for the panes of a wide window: Home as the companion, which
 * owns no header, and the form that a transaction tapped in Home opens in the primary pane.
 *
 * The account and holding create forms are registered here too: the transaction form's empty
 * holding pickers open them, and navigating to a name the stack does not register is unhandled,
 * which leaves the "Add holding" row doing nothing.
 */
const StatisticsStack: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      paneConfig={PANE_CONFIG}
      screenOptions={largeTitleScreenOptions}
      screenLayout={fittingLargeTitleLayout}
      screenListeners={resetTabStackOnBlur}
    >
      <Stack.Screen
        name="Statistics"
        component={StatisticsScreen}
        options={{ title: t('statistics.title') }}
      />

      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />

      <Stack.Screen
        name="TransactionForm"
        component={TransactionFormScreen}
        options={{ title: t('forms.transaction.addTitle') }}
      />

      <Stack.Screen
        name="AccountForm"
        component={AccountFormScreen}
        listeners={restoreDefaultAnimationOfSwappedForm}
        options={({ route }) => accountFormOptions(t, route)}
      />

      <Stack.Screen
        name="HoldingForm"
        component={HoldingFormScreen}
        listeners={restoreDefaultAnimationOfSwappedForm}
        options={({ route }) => holdingFormOptions(t, route)}
      />
    </Stack.Navigator>
  );
};

export default StatisticsStack;
