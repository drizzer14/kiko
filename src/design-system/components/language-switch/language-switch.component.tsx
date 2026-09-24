import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import ChipRow from '../chip-row';
import { appLanguages } from '../../../i18n';

import type { LanguageSwitchProps } from './language-switch.props';

// A labeled language toggle. Delegates to the shared ChipRow (decision 24:
// the merged former-OptionPills chips component) — ChipRow's `icon` slot
// renders an SF Symbol through SymbolIcon and cannot draw a flag emoji, so
// the flag is composed into each option's `labels` entry instead — the
// text-only chip shape. The label copy lives in the catalog under
// `language.en` / `language.uk` (each an endonym in its own script), so it
// reads identically regardless of the active UI language.
const LanguageSwitch: FC<LanguageSwitchProps> = ({ selected, onSelect }) => {
  const { t } = useTranslation();

  const labels = Object.fromEntries(
    appLanguages.map((language) => [language, t(`language.${language}`)]),
  ) as Record<(typeof appLanguages)[number], string>;

  return <ChipRow options={appLanguages} selected={selected} onSelect={onSelect} labels={labels} />;
};

export default LanguageSwitch;
