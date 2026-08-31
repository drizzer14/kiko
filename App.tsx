// Must run first: configures the Unistyles StyleSheet (themes) as a side
// effect before any component that calls StyleSheet.create is imported.
import './src/design-system/unistyles';

import { NavigationContainer } from '@react-navigation/native';
import { type FC, useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MigrationsGate from './src/db/migrations.gate';
import { navigationDarkTheme } from './src/navigation/dark-theme';
import RootNavigator from './src/navigation/root.navigator';
import { settingsRepo } from './src/repositories/settings.repo';

/**
 * Rendered only once `MigrationsGate` reports success, so its mount is the
 * signal that the schema is ready. Ensures the single settings row exists,
 * then hands off to the navigation stack.
 */
const AppRoot: FC = () => {
  useEffect(() => {
    void settingsRepo.ensure();
  }, []);

  return (
    <NavigationContainer theme={navigationDarkTheme}>
      <RootNavigator />
    </NavigationContainer>
  );
};

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <MigrationsGate>
        <AppRoot />
      </MigrationsGate>
    </SafeAreaProvider>
  );
}
