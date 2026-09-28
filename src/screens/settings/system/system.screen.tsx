import type { FC } from 'react';
import { match } from 'ts-pattern';
import { Alert } from 'react-native';
import { confirmOwner } from '@kiko/auth';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import { useDataReady, useLiveQuery } from '@kiko/db';
import Card from '@kiko/design-system/components/card';
import Screen from '@kiko/design-system/components/screen';
import SettingsRow from '@kiko/screens/settings/settings-row';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import LanguageSwitch from '@kiko/design-system/components/language-switch';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type AppLanguage, deviceLanguage } from '@kiko/i18n/device-language';

import AppLockSetting from './app-lock-setting/app-lock-setting.component';

type SystemScreenProps = NativeStackScreenProps<SettingsStackParamList, 'System'>;

// The System settings sub-screen: system-level preferences grouped away from the
// finance settings that live on the main Settings screen. A pushed screen (not a
// tab root), so — like the Categories sub-screen — it uses `<Screen scroll>`
// without the active-tab re-tap scroll-to-top hook (that is only for a tab's
// root screen). Order: Language, then Face ID (App Lock).
const SystemScreen: FC<SystemScreenProps> = () => {
  const { t } = useTranslation();

  const { data, isLoading } = useLiveQuery(settingsRepo.getQuery(), ['settings'], true, {
    cached: true,
  });
  const settings = data.at(0);
  // The App Lock toggle and the selected language must never render their
  // own defaults (off, device-default) while settings is still on its own
  // first load (kiko-architecture's useLiveQuery consumer rule).
  const isReady = useDataReady(isLoading);

  const handleSelectLanguage = (language: AppLanguage): void => {
    settingsRepo.setLanguage(language);
  };

  const confirmAndDisable = async (): Promise<void> => {
    const confirmation = await confirmOwner(t('auth.reason.disableLock'));

    match(confirmation)
      // A device with no passcode has no owner authentication to run at
      // all — iOS itself asks for the old passcode before it removes one.
      .with({ kind: 'confirmed' }, { kind: 'noPasscode' }, () => settingsRepo.setLockEnabled(false))
      .with({ kind: 'cancelled' }, () => undefined)
      .with({ kind: 'failed' }, (result) =>
        Alert.alert(t('auth.reauth.failedTitle'), t(result.hintKey)),
      )
      .exhaustive();
  };

  const { onPress: disableLock } = useSubmitOnce(confirmAndDisable);

  const handleToggleLock = (enabled: boolean): void => {
    enabled ? settingsRepo.setLockEnabled(true) : disableLock();
  };

  // The effective language shown as selected: the explicit choice if set,
  // otherwise the device-detected default. null in the DB means "follow device".
  const effectiveLanguage = settings?.language ?? deviceLanguage();

  if (!isReady) {
    return (
      <Screen scroll>
        <LoadingState testID="system-loading" />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Box gap={4}>
        <Card testID="settings-card-language" padding={3}>
          <SettingsRow testID="settings-row-language" icon="globe" label={t('settings.language')}>
            <LanguageSwitch selected={effectiveLanguage} onSelect={handleSelectLanguage} />
          </SettingsRow>
        </Card>

        <AppLockSetting lockEnabled={settings?.lockEnabled ?? false} onToggle={handleToggleLock} />
      </Box>
    </Screen>
  );
};

export default SystemScreen;
