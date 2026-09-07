import { useEffect } from 'react';
import { UnistylesRuntime } from 'react-native-unistyles';
import { match } from 'ts-pattern';

import { useLiveQuery } from '../db/use-live-query';
import { settingsRepo } from '../repositories/settings.repo';

/**
 * Drives Unistyles from the persisted appearance choice. Reads the settings row
 * the same way settings.screen.tsx does. Mounted once from AppRoot, after
 * MigrationsGate (the settings table exists). 'system' hands control back to
 * the OS via adaptiveThemes; 'light'/'dark' pin the theme.
 */
export const useSyncAppearanceWithSettings = (): void => {
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const appearance = data.at(0)?.appearance;

  useEffect(() => {
    if (appearance == null) {
      return;
    }

    match(appearance)
      .with('system', () => {
        UnistylesRuntime.setAdaptiveThemes(true);
      })
      .with('light', 'dark', (theme) => {
        UnistylesRuntime.setAdaptiveThemes(false);
        UnistylesRuntime.setTheme(theme);
      })
      .exhaustive();
  }, [appearance]);
};
