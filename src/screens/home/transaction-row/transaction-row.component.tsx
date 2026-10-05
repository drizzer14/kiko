import { type FC, memo } from 'react';
import { Pressable } from 'react-native';
import { formatTime } from '@kiko/dates';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { useTimeClock } from '@kiko/i18n/use-time-clock';
import { transactionsRepo } from '@kiko/transactions/repo';
import { resolveCategoryDisplay } from '@kiko/categories/category-display';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { isTimeExemptHoldingType } from '@kiko/holdings/holding-descriptor';
import { useBalanceBoundary } from '@kiko/transactions/use-balance-boundary';
import TransactionCard from '@kiko/design-system/components/transaction-card';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import { transactionRowDescription } from '@kiko/transactions/row-description';
import { importDeleteKeepsBalance } from '@kiko/transactions/balance-boundary';
import { isDeletableTransaction, isSyncedTransaction } from '@kiko/holdings/deletable';

import { styles } from './transaction-row.styles';
import type { TransactionRowProps } from './transaction-row.props';

const TransactionRow: FC<TransactionRowProps> = ({
  item,
  categoryByKey,
  defaultCategoryKey,
  holdingNameById,
  categoryKeyForRow,
  onPress,
  onDuplicate,
}) => {
  const { t } = useTranslation();
  const clock = useTimeClock();
  const isSynced = isSyncedTransaction(item);
  // Only an imported row's confirm needs the boundary, so every other row runs
  // no query.
  const { boundary } = useBalanceBoundary(item.holdingId, item.source === 'import');
  const deleteMessage = importDeleteKeepsBalance(item, boundary)
    ? t('transactions.deleteImportedKeepsBalance')
    : undefined;

  const category = resolveCategoryDisplay(item.category, categoryByKey, defaultCategoryKey);
  const description = transactionRowDescription({
    transaction: item,
    holdingName: item.holdingName,
    holdingNameById,
    t,
  });

  // Every row is tappable: it opens the shared Transaction form for this id.
  // A manual row edits; a synced (Monobank) row opens read-only — the form
  // resolves which from the transaction's own `source`, so the row only needs
  // to pass the id.
  //
  // The row's presentational body is the shared `TransactionCard` — the
  // SAME card `ExampleTransaction` previews a statement import through, so
  // a real Home row and its import preview render
  // identically. `TransactionCard` owns the `Card` content surface itself;
  // this component keeps only the tap/hold wrapping below.
  //
  // The row wraps in the shared `CardContextMenu` (touch-and-hold to delete),
  // mirroring the holding-detail ledger: a manual or imported row is deletable
  // and routes its confirm through `transactionsRepo.remove`, which already
  // guards a synced row (throws) and reverses the balance in one transaction;
  // a synced (Monobank/crypto) row is not deletable, so `CardContextMenu`
  // renders it bare — no gesture at all. An imported row is not duplicable
  // either, so its hold opens the delete confirm directly.
  //
  // This is a PLAIN list row (no `react-native-sortables` grid), unlike the
  // account/holding cards, so it gets no free scale-up lift from a grid's own
  // `activeItemScale`. `liftOnHold` opts this one usage into the identical
  // `CardContextMenu`-driven lift instead, matching the account/holding feel
  // on a long press — see that prop's own doc comment for why the account/
  // holding cards must never pass it.
  return (
    <CardContextMenu
      name={description}
      deletable={isDeletableTransaction(item)}
      deleteMessage={deleteMessage}
      onDelete={() => transactionsRepo.remove(item.id)}
      // A synced row is not duplicable — pass no handler so its long-press keeps
      // offering nothing (it already renders bare). A manual row's Duplicate
      // opens the create form pre-filled from this row.
      onDuplicate={isSynced ? undefined : () => onDuplicate(item.id)}
      liftOnHold
    >
      <Pressable accessibilityRole="button" onPress={() => onPress(item.id)}>
        <TransactionCard
          title={description}
          categoryIcon={category.icon}
          // The row icon and this category's filter chip must hash on the
          // SAME resolved key (`categoryKeyForRow`, below): hashing here on
          // the raw lowercased slug renders one category in two hues
          // whenever that slug is absent from the categories table, since
          // the chip has already folded it onto the default key.
          categoryIconColor={resolveCategoryColor(category.color, categoryKeyForRow(item.category))}
          categoryAccessibilityLabel={category.title}
          money={Money.of(item.currency, item.amountMinorUnits)}
          footerMeta={`${item.accountName} · ${category.title}`}
          footerTrailing={
            isTimeExemptHoldingType(item.holdingType) ? undefined : formatTime(item.time, clock)
          }
          loanLinked={item.loanHoldingId !== null}
          style={styles.rowCard}
          testID="transaction-row"
        />
      </Pressable>
    </CardContextMenu>
  );
};

export default memo(TransactionRow);
