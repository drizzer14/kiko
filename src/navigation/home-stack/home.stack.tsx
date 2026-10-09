import type { FC } from 'react';
import HomeScreen from '@kiko/screens/home';
import { useTranslation } from 'react-i18next';
import StatisticsScreen from '@kiko/screens/statistics';
import TransactionFormScreen from '@kiko/screens/forms/transaction-form';

import type { HomeStackParamList } from '../types';
import { createPaneStackNavigator } from '../pane-stack';
import { resetTabStackOnBlur } from '../reset-tab-stack-on-blur';

const Stack = createPaneStackNavigator<HomeStackParamList>();

// Home is what the outer display shows, so it takes the primary pane; Statistics fills the
// companion until something else opens there.
const PANE_CONFIG = {
  rootPane: 'primary',
  companionDefault: { name: 'Statistics', isDefault: true },
} as const;

/**
 * The Home tab's native stack. Home itself owns no title and no back button, so
 * its header is hidden. Tapping a transaction row pushes the shared Transaction
 * form onto this same stack, so it opts its own header back on (with a back
 * button) and a large title; the form drives that title itself via
 * `setOptions` (Add / Edit / read-only), so no static title is set here.
 * Statistics is registered for the companion pane of a wide window, where it
 * shows as a large-title screen.
 */
const HomeStack: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      paneConfig={PANE_CONFIG}
      screenOptions={{ headerShown: false }}
      screenListeners={resetTabStackOnBlur}
    >
      <Stack.Screen name="Home" component={HomeScreen} />

      <Stack.Screen
        name="TransactionForm"
        component={TransactionFormScreen}
        options={{ headerShown: true, headerLargeTitle: true }}
      />

      <Stack.Screen
        name="Statistics"
        component={StatisticsScreen}
        options={{ headerShown: true, headerLargeTitle: true, title: t('statistics.title') }}
      />
    </Stack.Navigator>
  );
};

export default HomeStack;
