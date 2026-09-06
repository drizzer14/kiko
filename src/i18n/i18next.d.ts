import type { en } from './locales/en';

// Types t()/useTranslation off en.ts. Key 'settings.language' resolves; a typo
// like 'settings.langauge' fails tsc, so a wrong key is a compile error, not a
// runtime blank. defaultNS is the whole flattened en object under one namespace.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
