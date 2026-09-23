import { resolveCategoryDisplay } from '@kiko/categories/category-display';
import { Money } from '@kiko/currency/money';
import { formatTime } from '@kiko/dates/format';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import MoneyText from '@kiko/design-system/components/money-text';
import SymbolIcon from '@kiko/design-system/components/symbol';
import Text from '@kiko/design-system/components/text';
import { isSyncedTransaction } from '@kiko/holdings/deletable';
import { isTimeExemptHoldingType } from '@kiko/holdings/holding-type';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { transactionsRepo } from '@kiko/transactions/repo';
import { transactionRowDescription } from '@kiko/transactions/row-description';
import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { TransactionRowProps } from './transaction-row.props';
import { styles } from './transaction-row.styles';

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
  const { theme } = useUnistyles();
  const isSynced = isSyncedTransaction(item);

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
  // The card is the shared solid content-layer `Card` — a flat, opaque
  // `surface` fill with a defined border, no drift or legibility concern to
  // manage while the list scrolls (unlike the `GlassSurface translucentStrong
  // bloom` combination this row used before: Apple's iOS Human Interface
  // Guidelines reserve Liquid Glass for the navigation layer, not scrolling
  // content, so this row no longer needs a glass-material anti-drift pin or
  // a legibility wash at all).
  //
  // The row wraps in the shared `CardContextMenu` (touch-and-hold to delete),
  // mirroring the holding-detail ledger: a manual row is deletable and routes
  // its confirm through `transactionsRepo.remove`, which already guards a
  // synced row (throws) and reverses the balance in one transaction; a synced
  // (Monobank/crypto) row is not deletable, so `CardContextMenu` renders it
  // bare — no gesture at all.
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
      deletable={!isSynced}
      onDelete={() => transactionsRepo.remove(item.id)}
      // A synced row is not duplicable — pass no handler so its long-press keeps
      // offering nothing (it already renders bare). A manual row's Duplicate
      // opens the create form pre-filled from this row (D2).
      onDuplicate={isSynced ? undefined : () => onDuplicate(item.id)}
      liftOnHold
    >
      <Pressable accessibilityRole="button" onPress={() => onPress(item.id)}>
        <Card padding={3} testID="transaction-row" style={styles.rowCard}>
          <Box gap={2}>
            <Box direction="row" style={styles.rowMain}>
              <Box direction="row" gap={2} style={styles.rowLead}>
                <SymbolIcon
                  name={category.icon}
                  size={theme.iconSizes.body}
                  tone="textSecondary"
                  // The row icon and this category's filter chip must hash on the
                  // SAME resolved key (`categoryKeyForRow`, above): hashing here
                  // on the raw lowercased slug renders one category in two hues
                  // whenever that slug is absent from the categories table, since
                  // the chip has already folded it onto the default key.
                  color={resolveCategoryColor(category.color, categoryKeyForRow(item.category))}
                  accessibilityLabel={category.title}
                />
                <Box style={styles.rowDescription}>
                  <Text variant="body">{description}</Text>
                </Box>
              </Box>
              <Box style={styles.rowAmount}>
                <MoneyText
                  money={Money.of(item.currency, item.amountMinorUnits)}
                  context="transaction"
                />
              </Box>
            </Box>
            <Box direction="row" gap={2} style={styles.rowFooter}>
              <Box style={styles.rowFooterMeta}>
                <Text variant="caption" tone="textSecondary">
                  {`${item.accountName} · ${category.title}`}
                </Text>
              </Box>
              {!isTimeExemptHoldingType(item.holdingType) && (
                <Text variant="caption" tone="textSecondary">
                  {formatTime(item.time)}
                </Text>
              )}
            </Box>
          </Box>
        </Card>
      </Pressable>
    </CardContextMenu>
  );
};

export default memo(TransactionRow);
