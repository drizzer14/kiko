// src/i18n/device-language.ts
import { NativeModules } from 'react-native';

export const appLanguages = ['en', 'uk'] as const;
export type AppLanguage = (typeof appLanguages)[number];

// The iOS-only, dependency-free device language read. SettingsManager is a
// React Native built-in; AppleLanguages is an ordered BCP-47 tag list, most
// preferred first. Only the primary subtag matters. Ukrainian and Russian
// speakers both get the Ukrainian catalog; everything else gets English.
export const deviceLanguage = (): AppLanguage => {
  const tag: string | undefined = NativeModules?.SettingsManager?.settings?.AppleLanguages?.[0];
  const primarySubtag = tag?.split('-')[0]?.toLowerCase();

  if (primarySubtag === 'uk' || primarySubtag === 'ru') {
    return 'uk';
  }

  return 'en';
};
