import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import type { Currency } from '../../currency/currency';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import CurrencySwitch from '../../design-system/components/currency-switch';
import GlassSurface from '../../design-system/components/glass-surface';
import Screen from '../../design-system/components/screen';
import type { SettingsStackParamList } from '../../navigation/types';
import { settingsRepo } from '../../repositories/settings.repo';
import SettingsRow from './settings-row.component';

type SettingsScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

const SettingsScreen: FC<SettingsScreenProps> = ({ navigation }) => {
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);

  const handleSelectCurrency = (currency: Currency): void => {
    void settingsRepo.setBaseCurrency(currency);
  };

  return (
    <Screen scroll>
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
            label="Base currency"
          >
            <CurrencySwitch selected={settings?.baseCurrency} onSelect={handleSelectCurrency} />
          </SettingsRow>
        </GlassSurface>
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
