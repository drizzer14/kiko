import { UnistylesRuntime } from 'react-native-unistyles';
import { match } from 'ts-pattern';

// The three appearance modes, mirroring src/i18n/device-language.ts's
// appLanguages shape. 'system' follows the OS (adaptiveThemes); 'light'/'dark'
// pin the theme. Persisted in settings.appearance, default 'system'.
export const appearances = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof appearances)[number];

/**
 * Drives Unistyles from an appearance choice: 'system' hands control back to
 * the OS via adaptiveThemes; 'light'/'dark' pin the theme. Shared by
 * `useSyncAppearanceWithSettings` (a live setting change from the Settings
 * screen) and `MigrationsGate`'s `applyPersistedAppearance` (the cold-launch
 * read, before either gate paints), so the mapping is defined once.
 */
export const applyAppearance = (appearance: Appearance): void => {
  match(appearance)
    .with('system', () => {
      UnistylesRuntime.setAdaptiveThemes(true);
    })
    .with('light', 'dark', (theme) => {
      UnistylesRuntime.setAdaptiveThemes(false);
      UnistylesRuntime.setTheme(theme);
    })
    .exhaustive();
};
