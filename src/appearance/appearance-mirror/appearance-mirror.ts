import { NativeModules, Settings } from 'react-native';

import { type AppearanceMode, parseAppearanceMode } from '../appearance-mode';

export const APPEARANCE_MIRROR_KEY = 'kiko.appearanceMode';

// The first frame reads the mode before the database opens. `Settings.get` throws where the
// native module is absent (jest), so the read goes through the settings constants, as
// `deviceLanguage` does.
export const readAppearanceMirror = (): AppearanceMode =>
  parseAppearanceMode(NativeModules?.SettingsManager?.settings?.[APPEARANCE_MIRROR_KEY]);

export const writeAppearanceMirror = (mode: AppearanceMode): void => {
  Settings.set({ [APPEARANCE_MIRROR_KEY]: mode });
};
