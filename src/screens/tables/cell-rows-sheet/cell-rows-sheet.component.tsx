import type { FC } from 'react';
import { match } from 'ts-pattern';
import { sumOf } from '@kiko/numbers';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable } from 'react-native';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import { useTimeClock } from '@kiko/i18n/use-time-clock';
import type { CellRow } from '@kiko/statistics/cell-rows';
import MoneyText from '@kiko/design-system/components/money-text';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import { transactionCardPropsOf } from '@kiko/transactions/card-props';
import TransactionCard from '@kiko/design-system/components/transaction-card';
import { useActiveColorScheme } from '@kiko/design-system/active-color-scheme';

import { styles } from './cell-rows-sheet.styles';
import type { CellRowsSheetProps } from './cell-rows-sheet.props';

// The screens' worth of rows kept mounted around the viewport: a long Total on a synced card holds
// hundreds of rows, each a card.
const WINDOW_SCREENS = 5;

const LOAN_PART_KEYS = {
  interest: 'tables.cellRows.loanInterest',
  fee: 'tables.cellRows.loanFee',
} as const;

// `base` and `native` are magnitudes, which the total and the cell sums rely on; an expense reads
// as the negative it is, as on Home, so it never shows green as income does.
const signedByFlow = (money: Money, flow: CellRow['flow']): Money =>
  match(flow)
    .with('expense', () => money.negate())
    .with('income', () => money)
    .exhaustive();

/**
 * The rows behind one table cell, each the card Home shows for a transaction. A tap on a row opens
 * its transaction, as a row on Home does: the sheet is told which row, and `onClosed` says when it
 * has finished closing, so the screen opens the form only then. There is no touch-and-hold menu on
 * a row. The total is the sum of the rows' base amounts, which is the cell by the same conversions.
 * The rows are a virtualized list of the sheet's own (`scrollable={false}`), so the total below
 * them stays in view.
 */
const CellRowsSheet: FC<CellRowsSheetProps> = ({
  visible,
  title,
  rows,
  baseCurrency,
  categoryDisplay,
  defaultCategoryKey,
  onDismiss,
  onPressRow,
  onClosed,
}) => {
  const { t } = useTranslation();
  const locale = activeLocale();
  const clock = useTimeClock();
  const scheme = useActiveColorScheme();
  const total = Money.of(baseCurrency, sumOf(rows.map((row) => row.base.minorUnits)));

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onClosed={onClosed}
      gap={2}
      scrollable={false}
      header={
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
      }
      testID="cell-rows-sheet"
    >
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item: row }) => (
          <Pressable accessibilityRole="button" onPress={() => onPressRow(row)}>
            <TransactionCard
              title={row.description}
              {...transactionCardPropsOf(row, {
                loanPartLabel: foldMap(maybe(row.loanPart), (part) => t(LOAN_PART_KEYS[part])),
                categoryByKey: categoryDisplay,
                defaultCategoryKey,
                scheme,
                clock,
                trailing: 'dateTime',
              })}
              // The base amount is the one that adds up to the cell; the row's own is under it
              // only when it is another currency's.
              money={signedByFlow(row.base, row.flow)}
              amountCaption={
                row.native.currency === baseCurrency
                  ? undefined
                  : formatMoney(signedByFlow(row.native, row.flow), locale)
              }
              testID={`cell-row-${row.id}`}
            />
          </Pressable>
        )}
        windowSize={WINDOW_SCREENS}
        showsVerticalScrollIndicator={false}
        style={styles.list}
        contentContainerStyle={styles.rows}
        testID="cell-rows-list"
      />

      <Box direction="row" style={styles.total} testID="cell-rows-total">
        <Text variant="body">{t('tables.total')}</Text>
        <MoneyText money={total} />
      </Box>
    </BottomSheet>
  );
};

export default CellRowsSheet;
