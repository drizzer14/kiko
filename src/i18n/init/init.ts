import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en, uk } from '../locales';
import { deviceLanguage } from '../device-language';
import { installPluralRulesFallback } from '../plural-rules';

installPluralRulesFallback();

// Mirrors src/design-system/unistyles/unistyles.ts: a side-effect module imported first
// in App.tsx, before any component that calls useTranslation renders, so the
// very first paint (including MigrationsGate's own UI) is in the device
// language. Initialized synchronously — resources are bundled, not fetched.
i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uk: { translation: uk },
  },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const i18n = i18next;
