import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScrollView } from 'react-native';
import { useAnimatedRef } from 'react-native-reanimated';

import type { Currency } from '../../currency/currency';
import { APP_LOCK_ENABLED } from '../../db/db-config';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import CurrencySwitch from '../../design-system/components/currency-switch';
import GlassSurface from '../../design-system/components/glass-surface';
import LanguageSwitch from '../../design-system/components/language-switch';
import Screen from '../../design-system/components/screen';
import { type AppLanguage, deviceLanguage } from '../../i18n';
import type { SettingsStackParamList } from '../../navigation/types';
import { useScrollToTopOnTabPress } from '../../navigation/use-scroll-to-top-on-tab-press';
import { settingsRepo } from '../../repositories/settings.repo';

import AppLockSetting from './app-lock-setting/app-lock-setting.component';
import SettingsRow from './settings-row';

type SettingsScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

const SettingsScreen: FC<SettingsScreenProps> = ({ navigation }) => {
  // Re-tapping the Settings tab while already on it returns this scrolling page
  // to the top (the standard iOS active-tab re-tap), driven off the native tab
  // navigator's `tabPress`.
  const scrollRef = useAnimatedRef<ScrollView>();
  useScrollToTopOnTabPress(scrollRef);

  const { t } = useTranslation();

  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);

  const handleSelectCurrency = (currency: Currency): void => {
    settingsRepo.setBaseCurrency(currency);
  };

  const handleToggleLock = (enabled: boolean): void => {
    settingsRepo.setLockEnabled(enabled);
  };

  const handleSelectLanguage = (language: AppLanguage): void => {
    settingsRepo.setLanguage(language);
  };

  // The effective language shown as selected: the explicit choice if set,
  // otherwise the device-detected default. null in the DB means "follow device".
  const effectiveLanguage = settings?.language ?? deviceLanguage();

  return (
    <Screen scroll scrollableRef={scrollRef}>
      {/* Each setting is its own GlassSurface card, mirroring the Accounts
          list — the Box gap gives the vertical space between cards. For now,
          if more settings appear that belong together they can be grouped back
          into a shared card; until then one-card-per-setting keeps them
          visually distinct. */}
      <Box gap={4}>
        <GlassSurface testID="settings-card-base-currency" padding={3}>
          <SettingsRow
            testID="settings-row-base-currency"
            icon="dollarsign.circle"
            label={t('settings.baseCurrency')}
          >
            <CurrencySwitch selected={settings?.baseCurrency} onSelect={handleSelectCurrency} />
          </SettingsRow>
        </GlassSurface>

        <GlassSurface testID="settings-card-language" padding={3}>
          <SettingsRow testID="settings-row-language" icon="globe" label={t('settings.language')}>
            <LanguageSwitch selected={effectiveLanguage} onSelect={handleSelectLanguage} />
          </SettingsRow>
        </GlassSurface>

        {/* Gated behind APP_LOCK_ENABLED, which is ON in every shipping build
            (see src/db/db-config.ts). The gate exists so a build compiled
            without the biometrics pod shows no non-functional App Lock toggle. */}
        {APP_LOCK_ENABLED && (
          <AppLockSetting
            lockEnabled={settings?.lockEnabled ?? false}
            onToggle={handleToggleLock}
          />
        )}

        <GlassSurface testID="settings-card-categories" padding={3}>
          <SettingsRow
            testID="settings-row-categories"
            icon="square.grid.2x2"
            label={t('settings.categories')}
            onPress={() => navigation.navigate('Categories')}
          />
        </GlassSurface>
      </Box>
    </Screen>
  );
};

export default SettingsScreen;
