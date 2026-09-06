import type { AppLanguage } from '../../../i18n';

export type LanguageSwitchProps = {
  selected: AppLanguage | undefined;
  onSelect: (language: AppLanguage) => void;
};
