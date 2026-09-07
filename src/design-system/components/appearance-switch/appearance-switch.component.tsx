import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { appearances } from '../../../appearance/appearance';
import OptionPills from '../option-pills';

import type { AppearanceSwitchProps } from './appearance-switch.props';

// A segmented System/Light/Dark toggle, delegating pill markup to the shared
// OptionPills (like LanguageSwitch). Text-only pills — no SF Symbol icon.
const AppearanceSwitch: FC<AppearanceSwitchProps> = ({ selected, onSelect }) => {
  const { t } = useTranslation();

  return (
    <OptionPills
      options={appearances}
      selected={selected}
      onSelect={onSelect}
      label={(appearance) => t(`appearance.${appearance}`)}
    />
  );
};

export default AppearanceSwitch;
