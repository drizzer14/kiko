import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useRef } from 'react';
import type { ScrollView } from 'react-native';

import type { Currency } from '../../currency/currency';
import { APP_LOCK_ENABLED } from '../../db/db-config';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import CurrencySwitch from '../../design-system/components/currency-switch';
import GlassSurface from '../../design-system/components/glass-surface';
import Screen from '../../design-system/components/screen';
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
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnTabPress(scrollRef);

  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);

  const handleSelectCurrency = (currency: Currency): void => {
    settingsRepo.setBaseCurrency(currency);
  };

  const handleToggleLock = (enabled: boolean): void => {
    settingsRepo.setLockEnabled(enabled);
  };

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
            label="Base Currency"
          >
            <CurrencySwitch selected={settings?.baseCurrency} onSelect={handleSelectCurrency} />
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

        <GlassSurface testID="settings-card-categories" padding={3}>
          <SettingsRow
            testID="settings-row-categories"
            icon="square.grid.2x2"
            label="Categories"
            onPress={() => navigation.navigate('Categories')}
          />
        </GlassSurface>
      </Box>
    </Screen>
  );
};

export default SettingsScreen;
