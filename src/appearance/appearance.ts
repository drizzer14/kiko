import { Appearance as RNAppearance } from 'react-native';
import { match } from 'ts-pattern';

// The three appearance modes, mirroring src/i18n/device-language.ts's
// appLanguages shape. 'system' follows the OS (adaptiveThemes); 'light'/'dark'
// pin the theme. Persisted in settings.appearance, default 'system'. The
// element ORDER is now inert: the switcher UI is the two-switch
// AppearanceToggles (a Follow-System / Dark-Mode pair driven by
// appearance-toggles.mapping, which never reads this array), so no component
// renders these in order any more (the old single-row AppearanceSwitch that
// justified 'system' sitting in the middle was removed in the Task 1 two-switch
// rework). The only consumers left are the `Appearance` union type derived
// below (order-independent) and this array's own equality self-test in
// appearance.test.ts; nothing indexes into it (the persisted value is the
// string key itself, `settings.appearance`, never an index). Left unreordered
// only to keep that self-test and git history stable.
export const appearances = ['light', 'system', 'dark'] as const;
export type Appearance = (typeof appearances)[number];

/**
 * Drives the whole app's colour scheme through a SINGLE mechanism:
 * `RNAppearance.setColorScheme` (React Native 0.87's app-level interface
 * override). Unistyles is registered with `adaptiveThemes: true`
 * (`src/design-system/unistyles.ts`), so it resolves `lightTheme`/`darkTheme`
 * from the app's EFFECTIVE appearance — which `setColorScheme` controls. That
 * makes this one call drive BOTH the JS themes (a live repaint of every
 * Unistyles component) AND every natively-drawn surface — the tab bar, stack
 * headers/large-title blur, system controls, the native date picker.
 *
 * Why a single mechanism: the previous version was a hybrid that ALSO called
 * `UnistylesRuntime.setAdaptiveThemes(false)` + `UnistylesRuntime.setTheme(...)`
 * alongside `setColorScheme`. Per the react-native-unistyles v3 docs,
 * `adaptiveThemes` and a manual `setTheme` are mutually exclusive (`setTheme`
 * throws while adaptive is on), and — with `adaptiveThemes: true` still
 * registered — the manual repaint fought the still-installed adaptive
 * appearance/trait observer plus the `setColorScheme` trait change, so an
 * in-app scheme switch did not stick at runtime (proven on-device). Driving the
 * scheme purely through `setColorScheme` removes that conflict: adaptive
 * Unistyles simply follows the override.
 *
 * The mapping: 'system' clears the app-level override with `'auto'` (adaptive
 * Unistyles then follows the OS); 'light'/'dark' pin the override to that
 * concrete scheme. Shared by `useSyncAppearanceWithSettings` (a live setting
 * change from the Settings screen) and `MigrationsGate`'s
 * `applyPersistedAppearance` (the cold-launch read, before either gate paints),
 * so the mapping is defined once.
 */
export const applyAppearance = (appearance: Appearance): void => {
  match(appearance)
    .with('system', () => RNAppearance.setColorScheme('auto'))
    .with('light', 'dark', (theme) => RNAppearance.setColorScheme(theme))
    .exhaustive();
};
