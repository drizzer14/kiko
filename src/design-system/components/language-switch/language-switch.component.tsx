import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { appLanguages } from '../../../i18n';
import OptionPills from '../option-pills';

import type { LanguageSwitchProps } from './language-switch.props';

// A segmented language toggle. It delegates the pill markup to the shared
// OptionPills (like CurrencySwitch), but OptionPills' `icon` slot renders an SF
// Symbol through SymbolIcon and cannot draw a flag emoji, so the flag is
// composed into the `label` string instead — the text-only pill shape. The
// label copy lives in the catalog under `language.en` / `language.uk` (each an
// endonym in its own script), so it reads identically regardless of the active
// UI language.
const LanguageSwitch: FC<LanguageSwitchProps> = ({ selected, onSelect }) => {
  const { t } = useTranslation();

  return (
    <OptionPills
      options={appLanguages}
      selected={selected}
      onSelect={onSelect}
      label={(language) => t(`language.${language}`)}
    />
  );
};

export default LanguageSwitch;
