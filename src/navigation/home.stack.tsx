import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import TransactionFormScreen from '../screens/forms/transaction-form.screen';
import HomeScreen from '../screens/home/home.screen';
import { resetTabStackOnBlur } from './reset-tab-stack-on-blur';
import type { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

/**
 * The Home tab's native stack. Home itself owns no title and no back button, so
 * its header is hidden. Tapping a transaction row pushes the shared Transaction
 * form onto this same stack, so it opts its own header back on (with a back
 * button) and a large title; the form drives that title itself via
 * `setOptions` (Add / Edit / read-only), so no static title is set here.
 */
const HomeStack: FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }} screenListeners={resetTabStackOnBlur}>
    <Stack.Screen name="Home" component={HomeScreen} />
    <Stack.Screen
      name="TransactionForm"
      component={TransactionFormScreen}
      options={{ headerShown: true, headerLargeTitle: true }}
    />
  </Stack.Navigator>
);

export default HomeStack;
