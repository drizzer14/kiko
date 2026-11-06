import type { FC } from 'react';
import HomeScreen from '@kiko/screens/home';
import { useTranslation } from 'react-i18next';
import TablesScreen from '@kiko/screens/tables';
import StatisticsScreen from '@kiko/screens/statistics';
import AccountFormScreen from '@kiko/screens/forms/account-form';
import HoldingFormScreen from '@kiko/screens/forms/holding-form';
import TransactionFormScreen from '@kiko/screens/forms/transaction-form';

import {
  accountFormOptions,
  holdingFormOptions,
  restoreDefaultAnimationOfSwappedForm,
} from '../swapped-form-options';
import { useIsMergedHome } from '../merged-home';
import type { HomeStackParamList } from '../types';
import { createPaneStackNavigator } from '../pane-stack';
import { fittingLargeTitleLayout } from '../fitting-large-title';
import { resetTabStackOnBlur } from '../reset-tab-stack-on-blur';
import { largeTitleScreenOptions } from '../large-title-screen-options';

const Stack = createPaneStackNavigator<HomeStackParamList>();

// Home is what the outer display shows, so it takes the primary pane; Statistics fills the
// companion until something else opens there. Tables opens in a layer over both panes, with Home
// and Statistics still behind it.
const PANE_CONFIG = {
  rootPane: 'primary',
  companionDefault: { name: 'Statistics', isDefault: true },
  wholeWindowRoutes: ['Tables'],
} as const;

/**
 * The Home tab's native stack. Home itself owns no title and no back button, so
 * its header is hidden. Tapping a transaction row pushes the shared Transaction
 * form onto this same stack, so it opts its own header back on (with a back
 * button) and a large title; the form drives that title itself via
 * `setOptions` (Add / Edit / read-only), so no static title is set here.
 * Statistics is registered for the companion pane of a wide window, where it
 * shows as a large-title screen; on a merged Home it is the cards pane of the
 * Home tab and shows no header, so the filter bar is its first row.
 *
 * The account and holding create forms are registered here too: the transaction
 * form's empty holding pickers open them, and a switch to the Accounts tab would
 * reset this stack and drop the form's draft.
 */
const HomeStack: FC = () => {
  const { t } = useTranslation();
  const isMergedHome = useIsMergedHome();

  return (
    <Stack.Navigator
      paneConfig={PANE_CONFIG}
      screenOptions={{ headerShown: false }}
      screenLayout={fittingLargeTitleLayout}
      screenListeners={resetTabStackOnBlur}
    >
      <Stack.Screen name="Home" component={HomeScreen} />

      <Stack.Screen
        name="TransactionForm"
        component={TransactionFormScreen}
        options={{ headerShown: true, ...largeTitleScreenOptions }}
      />

      <Stack.Screen
        name="Statistics"
        component={StatisticsScreen}
        options={{
          headerShown: !isMergedHome,
          ...largeTitleScreenOptions,
          title: t('statistics.title'),
        }}
      />

      {/* A small title in an opaque bar, because the table lays out below it, not under a large
          title. */}
      <Stack.Screen
        name="Tables"
        component={TablesScreen}
        options={{ headerShown: true, title: t('tables.title') }}
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
    </Stack.Navigator>
  );
};

export default HomeStack;
