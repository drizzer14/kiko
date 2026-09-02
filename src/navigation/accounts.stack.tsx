import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import AccountDetailScreen from '../screens/account-detail/account-detail.screen';
import AccountsScreen from '../screens/accounts/accounts.screen';
import AccountFormScreen from '../screens/forms/account-form.screen';
import HoldingFormScreen from '../screens/forms/holding-form.screen';
import TransactionFormScreen from '../screens/forms/transaction-form.screen';
import HoldingDetailScreen from '../screens/holding-detail/holding-detail.screen';
import { resetTabStackOnBlur } from './reset-tab-stack-on-blur';
import type { AccountsStackParamList } from './types';

const Stack = createNativeStackNavigator<AccountsStackParamList>();

/**
 * The Accounts tab's native stack. Every screen uses a large title, the
 * standard iOS pattern. The tab root ("Accounts") and the form screens carry
 * a static title here — the forms are add-only, so a constant "Add …" reads
 * correctly and belongs in the navigator config. The two detail screens set a
 * dynamic title (the account/holding name) from their own live-queried data
 * via `navigation.setOptions`, so they take no static title here; without one
 * a screen would otherwise show its raw camelCase route name.
 */
const AccountsStack: FC = () => (
  <Stack.Navigator screenOptions={{ headerLargeTitle: true }} screenListeners={resetTabStackOnBlur}>
    <Stack.Screen name="Accounts" component={AccountsScreen} />
    <Stack.Screen name="AccountDetail" component={AccountDetailScreen} />
    <Stack.Screen name="HoldingDetail" component={HoldingDetailScreen} />
    <Stack.Screen
      name="AccountForm"
      component={AccountFormScreen}
      options={{ title: 'Add Account' }}
    />
    <Stack.Screen
      name="HoldingForm"
      component={HoldingFormScreen}
      options={{ title: 'Add Holding' }}
    />
    <Stack.Screen
      name="TransactionForm"
      component={TransactionFormScreen}
      options={{ title: 'Add Transaction' }}
    />
  </Stack.Navigator>
);

export default AccountsStack;
