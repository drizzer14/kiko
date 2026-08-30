import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { useLiveQuery } from '../../db/use-live-query';
import { Box } from '../../design-system/components/box';
import { MoneyText } from '../../design-system/components/money-text';
import { Screen } from '../../design-system/components/screen';
import { Text } from '../../design-system/components/text';
import type { RootStackParamList } from '../../navigation/types';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';

type HoldingDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'HoldingDetail'>;

const formatTime = (time: number): string => new Date(time).toLocaleString();

export const HoldingDetailScreen: FC<HoldingDetailScreenProps> = ({ route, navigation }) => {
  const { holdingId } = route.params;
  const { theme } = useUnistyles();
  // `holdingsRepo` exposes no single-row lookup, so the holding's own
  // currency (needed to render each transaction's signed MoneyText) comes
  // from filtering the full holdings list for this id.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listByHoldingQuery(holdingId), [
    'transactions',
  ]);

  const holding = holdings.find(candidate => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title">{holding?.name ?? 'Holding'}</Text>

        <Box gap={2}>
          <Text variant="heading">Transactions</Text>
          {transactions.map(transaction => (
            <Box
              key={transaction.id}
              gap={1}
              style={[styles.row, { backgroundColor: theme.colors.surface }]}
            >
              <Box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="body">{transaction.description}</Text>
                <MoneyText money={Money.of(currency, transaction.amountMinorUnits)} />
              </Box>
              <Text variant="caption" tone="textSecondary">
                {formatTime(transaction.time)}
              </Text>
            </Box>
          ))}
        </Box>

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('TransactionForm', { holdingId })}
          style={[styles.button, { backgroundColor: theme.colors.accent, alignSelf: 'flex-start' }]}
        >
          <Text variant="body">Add transaction</Text>
        </Pressable>
      </Box>
    </Screen>
  );
};

const styles = StyleSheet.create(theme => ({
  button: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  row: {
    padding: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
