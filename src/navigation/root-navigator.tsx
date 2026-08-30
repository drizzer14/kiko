import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { AccountDetailScreen } from '../screens/account-detail-screen';
import { AccountFormScreen } from '../screens/account-form-screen';
import { HoldingDetailScreen } from '../screens/holding-detail-screen';
import { HoldingFormScreen } from '../screens/holding-form-screen';
import { HomeScreen } from '../screens/home-screen';
import { SettingsScreen } from '../screens/settings-screen';
import { TransactionFormScreen } from '../screens/transaction-form-screen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The app's single native stack. `NavigationContainer` is provided by the app
 * root (`App.tsx`), so this component renders only the navigator itself.
 */
export const RootNavigator: FC = () => (
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
