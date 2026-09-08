import { useEffect } from 'react';
import { Appearance } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import { useLiveQuery } from '../db/use-live-query';
import { settingsRepo } from '../repositories/settings.repo';

import { applyAppearance } from './appearance';

/**
 * Drives Unistyles from the persisted appearance choice. Reads the settings row
 * the same way settings.screen.tsx does. Mounted once from AppRoot, after
 * MigrationsGate (the settings table exists). The mapping itself lives in
 * `applyAppearance` (`./appearance`), shared with `MigrationsGate`'s
 * cold-launch `applyPersistedAppearance`.
 *
 * Option B: adaptiveThemes is OFF (`src/design-system/unistyles.ts`), so
 * Unistyles no longer follows OS scheme changes on its own. WHILE the persisted
 * choice is 'system' this installs a manual `Appearance.addChangeListener` that
 * flips the JS theme to the new OS scheme. The listener is GATED to 'system'
 * only — a light/dark pin must never be overridden by an OS change — and is
 * torn down on unmount or when the appearance changes away from 'system'.
 */
export const useSyncAppearanceWithSettings = (): void => {
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const appearance = data.at(0)?.appearance;

  useEffect(() => {
    if (appearance == null) {
      return;
    }

    applyAppearance(appearance);

    if (appearance !== 'system') {
      return;
    }

    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      UnistylesRuntime.setTheme(colorScheme ?? 'dark');
    });

    return () => subscription.remove();
  }, [appearance]);
};
