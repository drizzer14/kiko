import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import HomeScreen from '../screens/home/home.screen';
import type { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

/**
 * The Home tab's native stack. Home owns no title and no back button, so its
 * header is hidden; the tab bar is the only chrome.
 */
const HomeStack: FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Home" component={HomeScreen} />
  </Stack.Navigator>
);

export default HomeStack;
