import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import type { Appearance } from '../../appearance/appearance';
import { APP_LOCK_ENABLED } from '../../db/db-config';
import { useLiveQuery } from '../../db/use-live-query';
import AppearanceSwitch from '../../design-system/components/appearance-switch';
import Box from '../../design-system/components/box';
import GlassSurface from '../../design-system/components/glass-surface';
import LanguageSwitch from '../../design-system/components/language-switch';
import Screen from '../../design-system/components/screen';
import { type AppLanguage, deviceLanguage } from '../../i18n';
import type { SettingsStackParamList } from '../../navigation/types';
import { settingsRepo } from '../../repositories/settings.repo';

import AppLockSetting from './app-lock-setting/app-lock-setting.component';
import SettingsRow from './settings-row';

type SystemScreenProps = NativeStackScreenProps<SettingsStackParamList, 'System'>;

// The System settings sub-screen: system-level preferences grouped away from the
// finance settings that live on the main Settings screen. A pushed screen (not a
// tab root), so — like the Categories sub-screen — it uses `<Screen scroll>`
// without the active-tab re-tap scroll-to-top hook (that is only for a tab's
// root screen). Order: Language, then Color Scheme, then Face ID (App Lock).
const SystemScreen: FC<SystemScreenProps> = () => {
  const { t } = useTranslation();

  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);

  const handleSelectLanguage = (language: AppLanguage): void => {
    settingsRepo.setLanguage(language);
  };

  const handleToggleLock = (enabled: boolean): void => {
    settingsRepo.setLockEnabled(enabled);
  };

  const handleSelectAppearance = (appearance: Appearance): void => {
    settingsRepo.setAppearance(appearance);
  };

  // The effective language shown as selected: the explicit choice if set,
  // otherwise the device-detected default. null in the DB means "follow device".
  const effectiveLanguage = settings?.language ?? deviceLanguage();

  // The effective color scheme shown as selected: the explicit choice if set,
  // otherwise 'system' (follow the device's light/dark setting).
  const effectiveAppearance = settings?.appearance ?? 'system';

  return (
    <Screen scroll>
      <Box gap={4}>
        <GlassSurface testID="settings-card-language" padding={3}>
          <SettingsRow testID="settings-row-language" icon="globe" label={t('settings.language')}>
            <LanguageSwitch selected={effectiveLanguage} onSelect={handleSelectLanguage} />
          </SettingsRow>
        </GlassSurface>

        <GlassSurface testID="settings-card-color-scheme" padding={3}>
          <SettingsRow
            testID="settings-row-color-scheme"
            icon="circle.lefthalf.filled"
            label={t('settings.colorScheme')}
          >
            <AppearanceSwitch selected={effectiveAppearance} onSelect={handleSelectAppearance} />
          </SettingsRow>
        </GlassSurface>

        {/* Gated behind APP_LOCK_ENABLED (default OFF): a safe build without the
            biometrics pod shows no non-functional App Lock toggle. When the flag
            is flipped on for the supervised device step, the card appears. */}
        {APP_LOCK_ENABLED && (
          <AppLockSetting
            lockEnabled={settings?.lockEnabled ?? false}
            onToggle={handleToggleLock}
          />
        )}
      </Box>
    </Screen>
  );
};

export default SystemScreen;
