import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import AccountDetailScreen from '../screens/account-detail/account-detail.screen';
import AccountsScreen from '../screens/accounts/accounts.screen';
import AccountFormScreen from '../screens/forms/account-form.screen';
import HoldingFormScreen from '../screens/forms/holding-form.screen';
import TransactionFormScreen from '../screens/forms/transaction-form.screen';
import HoldingDetailScreen from '../screens/holding-detail/holding-detail.screen';
import type { AccountsStackParamList } from './types';

const Stack = createNativeStackNavigator<AccountsStackParamList>();

/**
 * The Accounts tab's native stack. Detail and form screens use large titles,
 * the standard iOS pattern; the tab root ("Accounts") shows a large title too.
 */
const AccountsStack: FC = () => (
  <Stack.Navigator screenOptions={{ headerLargeTitle: true }}>
    <Stack.Screen name="Accounts" component={AccountsScreen} />
    <Stack.Screen name="AccountDetail" component={AccountDetailScreen} />
    <Stack.Screen name="HoldingDetail" component={HoldingDetailScreen} />
    <Stack.Screen name="AccountForm" component={AccountFormScreen} />
    <Stack.Screen name="HoldingForm" component={HoldingFormScreen} />
    <Stack.Screen name="TransactionForm" component={TransactionFormScreen} />
  </Stack.Navigator>
);

export default AccountsStack;
