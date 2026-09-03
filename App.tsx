// Must run first: configures the Unistyles StyleSheet (themes) as a side
// effect before any component that calls StyleSheet.create is imported.
import './src/design-system/unistyles';

import { NavigationContainer } from '@react-navigation/native';
import { type FC, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MigrationsGate from './src/db/migrations.gate';
import { navigationDarkTheme } from './src/navigation/dark-theme';
import RootNavigator from './src/navigation/root.navigator';
import { settingsRepo } from './src/repositories/settings.repo';
import { useAutoSync } from './src/screens/use-auto-sync';

/**
 * Rendered only once `MigrationsGate` reports success, so its mount is the
 * signal that the schema is ready. Ensures the single settings row exists,
 * then hands off to the navigation stack. `useAutoSync` kicks off a
 * throttled background sync of the connected account without blocking this
 * first render.
 */
const AppRoot: FC = () => {
  useEffect(() => {
    settingsRepo.ensure();
  }, []);

  useAutoSync();

  return (
    <NavigationContainer theme={navigationDarkTheme}>
      <RootNavigator />
    </NavigationContainer>
  );
};

export default function App(): React.JSX.Element {
  return (
    // GestureHandlerRootView must wrap the whole app so react-native-gesture-handler
    // (and react-native-sortables, which builds its drag gestures on it) has a
    // root to attach native gesture recognizers to. `flex: 1` lets it fill the
    // screen; without it the tree would collapse to zero height.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MigrationsGate>
          <AppRoot />
        </MigrationsGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
