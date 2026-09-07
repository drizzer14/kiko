// The three appearance modes, mirroring src/i18n/device-language.ts's
// appLanguages shape. 'system' follows the OS (adaptiveThemes); 'light'/'dark'
// pin the theme. Persisted in settings.appearance, default 'system'.
export const appearances = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof appearances)[number];
