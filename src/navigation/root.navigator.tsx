import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import AccountDetailScreen from '../screens/account-detail/account-detail.screen';
import AccountFormScreen from '../screens/forms/account-form.screen';
import HoldingFormScreen from '../screens/forms/holding-form.screen';
import TransactionFormScreen from '../screens/forms/transaction-form.screen';
import HoldingDetailScreen from '../screens/holding-detail/holding-detail.screen';
import HomeScreen from '../screens/home/home.screen';
import SettingsScreen from '../screens/settings/settings.screen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The app's single native stack. `NavigationContainer` is provided by the app
 * root (`App.tsx`), so this component renders only the navigator itself.
 */
const RootNavigator: FC = () => (
  <Stack.Navigator initialRouteName="Home">
    <Stack.Screen name="Home" component={HomeScreen} />
    <Stack.Screen name="AccountDetail" component={AccountDetailScreen} />
    <Stack.Screen name="HoldingDetail" component={HoldingDetailScreen} />
    <Stack.Screen name="Settings" component={SettingsScreen} />
    <Stack.Screen name="AccountForm" component={AccountFormScreen} />
    <Stack.Screen name="HoldingForm" component={HoldingFormScreen} />
    <Stack.Screen name="TransactionForm" component={TransactionFormScreen} />
  </Stack.Navigator>
);

export default RootNavigator;
