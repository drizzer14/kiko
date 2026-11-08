import type { FC } from 'react';
import { sumOf } from '@kiko/numbers';
import { formatDate } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable } from 'react-native';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import MoneyText from '@kiko/design-system/components/money-text';
import EntryCard from '@kiko/design-system/components/entry-card';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';

import { styles } from './cell-rows-sheet.styles';
import type { CellRowsSheetProps } from './cell-rows-sheet.props';

// The screens' worth of rows kept mounted around the viewport: a long Total on a synced card holds
// hundreds of rows, each a card.
const WINDOW_SCREENS = 5;

const LOAN_PART_KEYS = {
  interest: 'tables.cellRows.loanInterest',
  fee: 'tables.cellRows.loanFee',
} as const;

/**
 * The rows behind one table cell. A tap on a row opens its transaction, as a row on Home does: the
 * sheet is told which row, and `onClosed` says when it has finished closing, so the screen opens
 * the form only then. There is no touch-and-hold menu on a row. The total is the sum of the rows'
 * base amounts, which is the cell by the same conversions. The rows are a virtualized list of the
 * sheet's own (`scrollable={false}`), so the total below them stays in view.
 */
const CellRowsSheet: FC<CellRowsSheetProps> = ({
  visible,
  title,
  rows,
  baseCurrency,
  onDismiss,
  onPressRow,
  onClosed,
}) => {
  const { t } = useTranslation();
  const locale = activeLocale();
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
            <EntryCard
              testID={`cell-row-${row.id}`}
              label={row.description}
              // The base amount is the one that adds up to the cell; the row's own is under the
              // description only when it is another currency's.
              subtitle={
                row.native.currency === baseCurrency ? undefined : formatMoney(row.native, locale)
              }
              amount={<MoneyText money={row.base} />}
              amountCaption={formatDate(row.time)}
              footerLines={foldMap(maybe(row.loanPart), (part) => [t(LOAN_PART_KEYS[part])]) ?? []}
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
