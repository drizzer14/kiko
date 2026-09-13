import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScrollViewInstance } from 'react-native';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import Box from '../../design-system/components/box';
import { useLiveQuery } from '../../db/use-live-query';
import Screen from '../../design-system/components/screen';
import type { SettingsStackParamList } from '../../navigation/types';
import GlassSurface from '../../design-system/components/glass-surface';
import CurrencyField from '../../design-system/components/currency-field';
import { type Currency, fiatCurrencyOptions } from '../../currency/currency';
import { useScrollToTopOnTabPress } from '../../navigation/use-scroll-to-top-on-tab-press';

import SettingsRow from './settings-row';

type SettingsScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

const SettingsScreen: FC<SettingsScreenProps> = ({ navigation }) => {
  // Re-tapping the Settings tab while already on it returns this scrolling page
  // to the top (the standard iOS active-tab re-tap), driven off the native tab
  // navigator's `tabPress`.
  const scrollRef = useAnimatedRef<ScrollViewInstance>();
  // The live `contentOffset.y`, so the hook can skip a redundant scroll.
  const scrollOffset = useScrollOffset(scrollRef);
  useScrollToTopOnTabPress(scrollRef, scrollOffset);

  const { t } = useTranslation();

  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);

  const handleSelectCurrency = (currency: Currency): void => {
    settingsRepo.setBaseCurrency(currency);
  };

  return (
    <Screen scroll scrollableRef={scrollRef}>
      {/* Each setting is its own GlassSurface card, mirroring the Accounts
          list — the Box gap gives the vertical space between cards. For now,
          if more settings appear that belong together they can be grouped back
          into a shared card; until then one-card-per-setting keeps them
          visually distinct. */}
      <Box gap={4}>
        {/* The System sub-page groups system-level preferences (Language, Color
            Scheme, Face ID) away from the finance settings below. It sits at the
            very top as a navigating row that pushes the System screen. */}
        <GlassSurface testID="settings-card-system" padding={3} transparent bloom>
          <SettingsRow
            testID="settings-row-system"
            icon="gearshape"
            label={t('settings.system')}
            onPress={() => navigation.navigate('System')}
          />
        </GlassSurface>

        {/* The base currency is FIAT-ONLY: it drives every net-worth conversion,
            so a crypto base (BTC) is not selectable here. The field reuses the
            shared searchable CurrencyField the account/holding forms use, its
            `options` restricted to `fiatCurrencyOptions`. Its own caption labels
            the control, so no wrapping SettingsRow header is needed. */}
        <GlassSurface testID="settings-card-base-currency" padding={3} transparent bloom>
          <CurrencyField
            testID="settings-row-base-currency"
            label={t('settings.baseCurrency')}
            selected={settings?.baseCurrency}
            onSelect={handleSelectCurrency}
            options={fiatCurrencyOptions}
          />
        </GlassSurface>

        <GlassSurface testID="settings-card-categories" padding={3} transparent bloom>
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
