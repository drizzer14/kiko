// Must run first: configures the Unistyles StyleSheet (themes) as a side
// effect before any component that calls StyleSheet.create is imported.
import '@kiko/design-system/unistyles';
// Must run first alongside Unistyles: initializes the i18next instance with the
// device language as a side effect, before any component that calls
// useTranslation renders.
import '@kiko/i18n/init';

import type { FC } from 'react';
import { LockGate } from '@kiko/auth';
import { useAutoSync } from '@kiko/sync/use-auto-sync';
import RootNavigator from '@kiko/navigation/root-navigator';
import MigrationsGate from '@kiko/migration/migrations-gate';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from '@kiko/navigation/navigation-ref';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { navigationDarkTheme } from '@kiko/navigation/dark-theme';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReminderScheduler } from '@kiko/reminders/use-reminder-scheduler';
import { useSyncLanguageWithSettings } from '@kiko/i18n/use-sync-language-with-settings';

/**
 * Rendered only once `MigrationsGate` reports success, so its mount is the
 * signal that the schema is ready — including the single settings row, which
 * `MigrationsGate`'s own init chain guarantees exists before this ever mounts.
 * Hands off to the navigation stack. `useAutoSync` kicks off a throttled
 * background sync of the connected account without blocking this first
 * render. `useReminderScheduler` re-plans the pending reminder notifications.
 */
const AppRoot: FC = () => {
  useSyncLanguageWithSettings();

  useAutoSync();

  useReminderScheduler();

  return (
    <NavigationContainer ref={navigationRef} theme={navigationDarkTheme}>
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
              database must be open and migrated (and the settings row ensured)
              first. Around AppRoot: while locked, nothing below (navigator,
              auto-sync) mounts. */}
          <LockGate>
            <AppRoot />
          </LockGate>
        </MigrationsGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
