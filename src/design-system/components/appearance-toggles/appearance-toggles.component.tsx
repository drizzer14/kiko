import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

import { resolveColorScheme } from '../../color-scheme';
import Box from '../box';
import Switch from '../switch';

import { appearanceFromToggles, togglesFromAppearance } from './appearance-toggles.mapping';
import type { AppearanceTogglesProps } from './appearance-toggles.props';

const AppearanceToggles: FC<AppearanceTogglesProps> = ({ appearance, onChange }) => {
  const { t } = useTranslation();
  const { rt } = useUnistyles();
  const resolvedScheme = resolveColorScheme(rt.themeName);
  const { followSystem, darkOn } = togglesFromAppearance(appearance, resolvedScheme);

  return (
    <Box gap={3}>
      <Switch
        testID="appearance-toggle-follow"
        label={t('appearance.followSystem')}
        value={followSystem}
        onValueChange={(next) => onChange(appearanceFromToggles(next, darkOn))}
      />

      <Switch
        testID="appearance-toggle-dark"
        label={t('appearance.darkMode')}
        value={darkOn}
        disabled={followSystem}
        onValueChange={(next) => onChange(appearanceFromToggles(followSystem, next))}
      />
    </Box>
  );
};

export default AppearanceToggles;
