import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { type AppearanceMode, appearanceModes } from '@kiko/appearance/appearance-mode';

import ChipRow from '../chip-row';

import type { AppearanceSwitchProps } from './appearance-switch.props';

// A labeled appearance toggle. Delegates to the shared ChipRow, as LanguageSwitch does. The
// labels read the active UI language, since a mode name is a word and not an endonym.
const AppearanceSwitch: FC<AppearanceSwitchProps> = ({ selected, onSelect }) => {
  const { t } = useTranslation();

  // `satisfies` pins this literal to exactly the `AppearanceMode` values, so a fourth mode
  // without a label here is a compile error and not a silently unlabeled chip.
  const labels = {
    system: t('appearance.system'),
    light: t('appearance.light'),
    dark: t('appearance.dark'),
  } satisfies Record<AppearanceMode, string>;

  return (
    <ChipRow options={appearanceModes} selected={selected} onSelect={onSelect} labels={labels} />
  );
};

export default AppearanceSwitch;
