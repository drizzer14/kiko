// Must run first: configures the Unistyles StyleSheet (themes) as a side
// effect before any component that calls StyleSheet.create is imported.
import './src/design-system/unistyles';
// Must run first alongside Unistyles: initializes the i18next instance with the
// device language as a side effect, before any component that calls
// useTranslation renders.
import './src/i18n';

import { SCREENSHOT_MODE } from '@env';
import { NavigationContainer } from '@react-navigation/native';
import type { FC } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LockGate from './src/auth/lock-gate/lock-gate.component';
import { useSyncLanguageWithSettings } from './src/i18n/use-sync-language-with-settings';
import MigrationsGate from './src/migration/migrations-gate';
import { navigationDarkTheme } from './src/navigation/dark-theme';
import RootNavigator from './src/navigation/root.navigator';
import { useAutoSync } from './src/sync/use-auto-sync';

/**
 * Rendered only once `MigrationsGate` reports success, so its mount is the
 * signal that the schema is ready — including the single settings row, which
 * `MigrationsGate`'s own init chain guarantees exists before this ever mounts.
 * Hands off to the navigation stack. `useAutoSync` kicks off a throttled
 * background sync of the connected account without blocking this first
 * render.
 */
const AppRoot: FC = () => {
  useSyncLanguageWithSettings();

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
      {/* DEV/TEST-ONLY: in a build made against `.env.screenshots`, force reduced
          motion app-wide via reanimated's official global switch so animations
          settle for deterministic screenshots. `SCREENSHOT_MODE` is inlined by
          react-native-dotenv at build time; the committed `.env` has no such
          key, so a production build inlines `undefined`, this folds to a dead
          `false` branch Metro strips (dropping the last production import of
          screenshot-mode.ts), and no other animation code is touched. */}
      {SCREENSHOT_MODE === 'true' ? <ReducedMotionConfig mode={ReduceMotion.Always} /> : null}
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
