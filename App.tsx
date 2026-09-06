// Must run first: configures the Unistyles StyleSheet (themes) as a side
// effect before any component that calls StyleSheet.create is imported.
import './src/design-system/unistyles';
// Must run first alongside Unistyles: initializes the i18next instance with the
// device language as a side effect, before any component that calls
// useTranslation renders.
import './src/i18n';

import { NavigationContainer } from '@react-navigation/native';
import { type FC, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LockGate from './src/auth/lock-gate/lock-gate.component';
import MigrationsGate from './src/db/migrations.gate';
import { useSyncLanguageWithSettings } from './src/i18n/use-sync-language-with-settings';
import { navigationDarkTheme } from './src/navigation/dark-theme';
import RootNavigator from './src/navigation/root.navigator';
import { settingsRepo } from './src/repositories/settings.repo';
import { useAutoSync } from './src/screens/use-auto-sync';
import { useNetWorthWidget } from './src/widget/use-net-worth-widget';

/**
 * Rendered only once `MigrationsGate` reports success, so its mount is the
 * signal that the schema is ready. Ensures the single settings row exists,
 * then hands off to the navigation stack. `useAutoSync` kicks off a
 * throttled background sync of the connected account without blocking this
 * first render. `useNetWorthWidget` keeps the home-screen widget's snapshot
 * current — debounced on live-query changes, and immediately on background.
 */
const AppRoot: FC = () => {
  useEffect(() => {
    settingsRepo.ensure();
  }, []);

  useSyncLanguageWithSettings();

  useAutoSync();
  useNetWorthWidget();

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
          {/* Inside MigrationsGate: the gate reads settings.lockEnabled, so the
              database must be open and migrated first. Around AppRoot: while
              locked, nothing below (navigator, auto-sync, ensure) mounts. */}
          <LockGate>
            <AppRoot />
          </LockGate>
        </MigrationsGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
