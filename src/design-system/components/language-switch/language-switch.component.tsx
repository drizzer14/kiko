import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { appLanguages } from '@kiko/i18n/device-language';

import ChipRow from '../chip-row';

import type { LanguageSwitchProps } from './language-switch.props';

// A labeled language toggle. Delegates to the shared ChipRow — ChipRow's
// `icon` slot renders an SF Symbol through SymbolIcon and cannot draw a flag
// emoji, so the flag is composed into each option's `labels` entry instead —
// the text-only chip shape. The label copy lives in the catalog under
// `language.en` / `language.uk` (each an endonym in its own script), so it
// reads identically regardless of the active UI language.
const LanguageSwitch: FC<LanguageSwitchProps> = ({ selected, onSelect }) => {
  const { t } = useTranslation();

  // `satisfies` pins this object literal to exactly the `appLanguages` keys,
  // so adding a third language without a matching label here is a compile
  // error rather than a silently-unlabeled chip.
  const labels = { uk: t('language.uk'), en: t('language.en') } satisfies Record<
    (typeof appLanguages)[number],
    string
  >;

  return <ChipRow options={appLanguages} selected={selected} onSelect={onSelect} labels={labels} />;
};

export default LanguageSwitch;
