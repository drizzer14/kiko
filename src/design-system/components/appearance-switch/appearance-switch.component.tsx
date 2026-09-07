import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { appearances } from '../../../appearance/appearance';
import OptionPills from '../option-pills';

import type { AppearanceSwitchProps } from './appearance-switch.props';

// A segmented Light/System/Dark toggle, delegating pill markup to the shared
// OptionPills (like LanguageSwitch). Text-only pills — no SF Symbol icon.
// `columns={appearances.length}` forces a single equal-width row of all 3
// options instead of OptionPills' default always-2-column wrap (which would
// otherwise leave the 3rd pill alone on its own row) — see OptionPills'
// `columns` prop doc.
const AppearanceSwitch: FC<AppearanceSwitchProps> = ({ selected, onSelect }) => {
  const { t } = useTranslation();

  return (
    <OptionPills
      options={appearances}
      selected={selected}
      onSelect={onSelect}
      label={(appearance) => t(`appearance.${appearance}`)}
      columns={appearances.length}
    />
  );
};

export default AppearanceSwitch;
