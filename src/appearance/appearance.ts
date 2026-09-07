import { Appearance as RNAppearance } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';
import { match } from 'ts-pattern';

// The three appearance modes, mirroring src/i18n/device-language.ts's
// appLanguages shape. 'system' follows the OS (adaptiveThemes); 'light'/'dark'
// pin the theme. Persisted in settings.appearance, default 'system'. Ordered
// with 'system' in the MIDDLE (not first) purely for the switcher's display
// order (AppearanceSwitch renders this array's order as a single row of 3
// pills) — this is a display-order choice only; nothing in the app indexes
// into this array or otherwise depends on its element order (the persisted
// value is the string key itself, `settings.appearance`, never an index).
export const appearances = ['light', 'system', 'dark'] as const;
export type Appearance = (typeof appearances)[number];

/**
 * Drives Unistyles AND the native iOS interface style from an appearance
 * choice: 'system' hands control back to the OS (Unistyles adaptiveThemes +
 * `Appearance.setColorScheme('auto')`, which clears the app-level override so
 * native chrome follows the OS); 'light'/'dark' pin both the Unistyles theme
 * and the native override so natively-drawn surfaces — the tab bar, stack
 * headers/large-title blur, system controls, the native date picker — resolve
 * against the same scheme as the JS UI instead of a build-time-constant style.
 * `RNAppearance.setColorScheme` is React Native 0.87's app-level interface
 * override; the 'light'/'dark' literal produced by the exhaustive match is
 * already the concrete scheme the native side wants, so no theme-name mapping
 * is needed here. Shared by `useSyncAppearanceWithSettings` (a live setting
 * change from the Settings screen) and `MigrationsGate`'s
 * `applyPersistedAppearance` (the cold-launch read, before either gate paints),
 * so the mapping is defined once.
 */
export const applyAppearance = (appearance: Appearance): void => {
  match(appearance)
    .with('system', () => {
      UnistylesRuntime.setAdaptiveThemes(true);
      RNAppearance.setColorScheme('auto');
    })
    .with('light', 'dark', (theme) => {
      UnistylesRuntime.setAdaptiveThemes(false);
      UnistylesRuntime.setTheme(theme);
      RNAppearance.setColorScheme(theme);
    })
    .exhaustive();
};
