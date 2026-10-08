import type { FC } from 'react';
import HomeScreen from '@kiko/screens/home';
import { useTranslation } from 'react-i18next';
import AccountFormScreen from '@kiko/screens/forms/account-form';
import HoldingFormScreen from '@kiko/screens/forms/holding-form';
import TransactionFormScreen from '@kiko/screens/forms/transaction-form';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import {
  accountFormOptions,
  holdingFormOptions,
  restoreDefaultAnimationOfSwappedForm,
} from '../swapped-form-options';
import type { HomeStackParamList } from '../types';
import { resetTabStackOnBlur } from '../reset-tab-stack-on-blur';

const Stack = createNativeStackNavigator<HomeStackParamList>();

/**
 * The Home tab's native stack. Home itself owns no title and no back button, so
 * its header is hidden. Tapping a transaction row pushes the shared Transaction
 * form onto this same stack, so it opts its own header back on (with a back
 * button) and a large title; the form drives that title itself via
 * `setOptions` (Add / Edit / read-only), so no static title is set here.
 *
 * The account and holding create forms are registered here too: the transaction
 * form's empty holding pickers open them, and a switch to the Accounts tab would
 * reset this stack and drop the form's draft.
 */
const HomeStack: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} screenListeners={resetTabStackOnBlur}>
      <Stack.Screen name="Home" component={HomeScreen} />

      <Stack.Screen
        name="TransactionForm"
        component={TransactionFormScreen}
        options={{ headerShown: true, headerLargeTitle: true }}
      />

      <Stack.Screen
        name="AccountForm"
        component={AccountFormScreen}
        listeners={restoreDefaultAnimationOfSwappedForm}
        options={({ route }) => ({
          ...accountFormOptions(t, route),
          headerShown: true,
          headerLargeTitle: true,
        })}
      />

      <Stack.Screen
        name="HoldingForm"
        component={HoldingFormScreen}
        listeners={restoreDefaultAnimationOfSwappedForm}
        options={({ route }) => ({
          ...holdingFormOptions(t, route),
          headerShown: true,
          headerLargeTitle: true,
        })}
      />
    </Stack.Navigator>
  );
};

export default HomeStack;
