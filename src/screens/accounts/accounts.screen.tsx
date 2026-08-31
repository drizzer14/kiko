import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import MoneyText from '../../design-system/components/money-text';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import type { AccountsStackParamList } from '../../navigation/types';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { styles } from './accounts.styles';

type AccountsScreenProps = NativeStackScreenProps<AccountsStackParamList, 'Accounts'>;

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
    <Screen>
      <Box gap={4} style={styles.content}>
        {activeAccounts.length === 0 ? (
          <Box style={styles.empty}>
            <Text tone="textSecondary">No accounts yet</Text>
          </Box>
        ) : (
          <Box style={styles.group}>
            {activeAccounts.map((account, index) => {
              const accountHoldings = holdings.filter(
                holding => holding.accountId === account.id && holding.closedAt == null,
              );
              const balance = guardedNetWorth(accountHoldings, baseCurrency, rateTable);
              const isLast = index === activeAccounts.length - 1;

              return (
                <Pressable
                  key={account.id}
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('AccountDetail', { accountId: account.id })}
                  style={[styles.row, isLast && styles.rowLast]}
                >
                  <Box gap={1}>
                    <Text variant="body">{account.name}</Text>
                    <Text variant="caption" tone="textSecondary">
                      {account.kind}
                    </Text>
                  </Box>
                  <MoneyText money={balance} />
                </Pressable>
              );
            })}
          </Box>
        )}

        <PressableButton
          onPress={() => navigation.navigate('AccountForm', {})}
          backgroundColor={theme.colors.accent}
          alignSelf="flex-start"
        >
          <Text variant="body">Add account</Text>
        </PressableButton>
      </Box>
    </Screen>
  );
};

export default AccountsScreen;
