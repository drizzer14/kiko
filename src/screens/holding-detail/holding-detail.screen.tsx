import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useLayoutEffect } from 'react';
import { Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import MoneyText from '../../design-system/components/money-text';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import { accruedInterest, holdingValue } from '../../holdings/holding-value';
import type { AccountsStackParamList } from '../../navigation/types';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { defaultTransactionDescription } from '../../transactions/default-description';

type HoldingDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingDetail'>;

const formatTime = (time: number): string => new Date(time).toLocaleString();

const HoldingDetailScreen: FC<HoldingDetailScreenProps> = ({ route, navigation }) => {
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
  const now = Date.now();
  const accrued = holding ? accruedInterest(holding, now) : null;

  // The stack sets no static title for this screen, so drive the header title
  // from the holding's own name once it loads — otherwise the header falls
  // back to the raw "HoldingDetail" route name. Skip until the name is known
  // so the header never flashes an empty title.
  const holdingName = holding?.name;
  useLayoutEffect(() => {
    if (holdingName !== undefined) {
      navigation.setOptions({ title: holdingName });
    }
  }, [navigation, holdingName]);

  return (
    <Screen scroll>
      <Box gap={4}>
        {holding && (
          <Box gap={1}>
            <Text variant="caption" tone="textSecondary">
              Value
            </Text>
            <MoneyText money={holdingValue(holding, now)} />
            {accrued && (
              <Box gap={1}>
                <Text variant="caption" tone="textSecondary">
                  Accrued interest
                </Text>
                <MoneyText money={accrued} />
              </Box>
            )}
          </Box>
        )}

        <Box gap={2}>
          <Text variant="heading">Transactions</Text>
          {transactions.map(transaction => (
            // Every row is tappable: it opens the shared Transaction form for
            // this id. A manual row edits; a synced (Monobank) row opens
            // read-only — the form resolves which from the transaction's own
            // `source`, so the row only needs to pass the id.
            <Pressable
              key={transaction.id}
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate('TransactionForm', { transactionId: transaction.id })
              }
            >
              <Box gap={1} style={[styles.row, { backgroundColor: theme.colors.surface }]}>
                <Box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="body">
                    {transaction.description ||
                      defaultTransactionDescription(
                        holdingName ?? '',
                        transaction.amountMinorUnits,
                      )}
                  </Text>
                  <MoneyText
                    money={Money.of(currency, transaction.amountMinorUnits)}
                    context="transaction"
                  />
                </Box>
                <Text variant="caption" tone="textSecondary">
                  {formatTime(transaction.time)}
                </Text>
              </Box>
            </Pressable>
          ))}
        </Box>

        <PressableButton
          onPress={() => navigation.navigate('TransactionForm', { holdingId })}
          backgroundColor={theme.colors.accent}
          alignSelf="flex-start"
        >
          <Text variant="body">Add transaction</Text>
        </PressableButton>
      </Box>
    </Screen>
  );
};

const styles = StyleSheet.create(theme => ({
  row: {
    padding: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));

export default HoldingDetailScreen;
