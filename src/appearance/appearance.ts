import { Appearance as RNAppearance } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';
import { match } from 'ts-pattern';

// The three appearance modes, mirroring src/i18n/device-language.ts's
// appLanguages shape. 'system' follows the OS (via a manual OS change listener,
// see applyAppearance below); 'light'/'dark' pin the theme. Persisted in settings.appearance, default 'system'. The
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
 * Drives the whole app's colour scheme through TWO coordinated mechanisms
 * (Option B — manual theme control):
 *   - `UnistylesRuntime.setTheme(...)` flips the Unistyles JS theme, a live
 *     repaint of every styled component;
 *   - `RNAppearance.setColorScheme(...)` (React Native 0.87's app-level
 *     interface override) flips every natively-drawn surface — the tab bar,
 *     stack headers/large-title blur, system controls, the native date picker.
 *
 * Why both, and why NOT adaptiveThemes: Unistyles' adaptive mode resolves the
 * active theme from the PHYSICAL OS trait (`UIScreen.main.traitCollection`),
 * not from `setColorScheme`'s app-level window override. So while adaptive was
 * on, a manual light/dark pin flipped only the native chrome and left every
 * Unistyles element on the OS scheme (proven on-device). Adaptive is therefore
 * OFF (`src/design-system/unistyles.ts`), which removes the mutual-exclusion
 * constraint — `setTheme` no longer throws — so this drives the JS theme
 * explicitly and no longer fights an adaptive trait observer.
 *
 * The mapping: 'light'/'dark' set BOTH the JS theme and the native override to
 * that concrete scheme; 'system' sets the JS theme to the CURRENT OS scheme
 * (`getColorScheme() ?? 'dark'`) and clears the native override with `'auto'`.
 * With adaptive off, Unistyles no longer follows subsequent OS scheme changes
 * on its own, so `useSyncAppearanceWithSettings` installs a manual
 * `Appearance.addChangeListener` while the persisted choice is 'system'.
 * Shared by `useSyncAppearanceWithSettings` (a live setting change from the
 * Settings screen) and `MigrationsGate`'s `applyPersistedAppearance` (the
 * cold-launch read, before either gate paints), so the mapping is defined once.
 */
export const applyAppearance = (appearance: Appearance): void => {
  match(appearance)
    .with('system', () => {
      UnistylesRuntime.setTheme(RNAppearance.getColorScheme() ?? 'dark');
      RNAppearance.setColorScheme('auto');
    })
    .with('light', 'dark', (theme) => {
      // Settle the native window interface-style trait BEFORE Unistyles commits
      // the JS theme, so the flip-origin screen's see-through glass re-samples
      // the new interface style on the same commit (avoids a light-scheme lag).
      RNAppearance.setColorScheme(theme);
      UnistylesRuntime.setTheme(theme);
    })
    .exhaustive();
};
