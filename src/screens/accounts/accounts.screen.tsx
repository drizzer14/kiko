import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import type { AccountRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import GlassSurface from '../../design-system/components/glass-surface';
import MoneyText from '../../design-system/components/money-text';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import type { AccountsStackParamList } from '../../navigation/types';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { styles } from './accounts.styles';

type AccountsScreenProps = NativeStackScreenProps<AccountsStackParamList, 'Accounts'>;

const KIND_LABEL: Record<AccountRow['kind'], string> = {
  bank: 'Bank',
  cash: 'Cash',
  crypto: 'Crypto',
  broker: 'Broker',
};

// Leading SF Symbol per account kind, mirroring KIND_LABEL.
const KIND_ICON: Record<AccountRow['kind'], string> = {
  bank: 'building.columns',
  cash: 'banknote',
  crypto: 'bitcoinsign.circle',
  broker: 'chart.line.uptrend.xyaxis',
};

const AccountsScreen: FC<AccountsScreenProps> = ({ navigation }) => {
  const { theme } = useUnistyles();
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);

  const activeAccounts = accounts.filter(account => account.archivedAt == null);

  return (
    <Screen
      scroll
      footer={
        <Box testID="add-account-footer" style={styles.addAccountButton}>
          <PressableButton
            onPress={() => navigation.navigate('AccountForm', {})}
            backgroundColor={theme.colors.accent}
            icon={<SymbolIcon name="plus" tone="textPrimary" />}
          >
            <Text variant="body">Add account</Text>
          </PressableButton>
        </Box>
      }
    >
      <Box gap={4} style={styles.content}>
        {activeAccounts.length === 0 ? (
          <Box style={styles.empty}>
            <Text tone="textSecondary">No accounts yet</Text>
          </Box>
        ) : (
          activeAccounts.map(account => {
            const accountHoldings = holdings.filter(
              holding => holding.accountId === account.id && holding.closedAt == null,
            );
            const balance = guardedNetWorth(accountHoldings, baseCurrency, rateTable);

            return (
              <GlassSurface key={account.id} testID="account-card" padding={3}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('AccountDetail', { accountId: account.id })}
                  style={styles.row}
                >
                  <Box direction="row" gap={3} style={styles.rowLead}>
                    <SymbolIcon name={KIND_ICON[account.kind]} tone="textSecondary" />
                    <Box gap={1}>
                      <Text variant="body">{account.name}</Text>
                      <Text variant="caption" tone="textSecondary">
                        {KIND_LABEL[account.kind]}
                      </Text>
                    </Box>
                  </Box>
                  <MoneyText money={balance} context="balance" />
                </Pressable>
              </GlassSurface>
            );
          })
        )}
      </Box>
    </Screen>
  );
};

export default AccountsScreen;
