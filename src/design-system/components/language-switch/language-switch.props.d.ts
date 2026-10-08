import type { AppLanguage } from '@kiko/i18n/device-language';

export type LanguageSwitchProps = {
  selected: AppLanguage | undefined;
  onSelect: (language: AppLanguage) => void;
};
