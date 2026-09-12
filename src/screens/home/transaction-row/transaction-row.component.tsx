import { resolveCategoryDisplay } from '@kiko/categories/category-display';
import { Money } from '@kiko/currency/money';
import { formatTime } from '@kiko/dates/format';
import Box from '@kiko/design-system/components/box';
import GlassSurface from '@kiko/design-system/components/glass-surface';
import MoneyText from '@kiko/design-system/components/money-text';
import SymbolIcon from '@kiko/design-system/components/symbol';
import Text from '@kiko/design-system/components/text';
import { isTimeExemptHoldingType } from '@kiko/holdings/holding-type';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
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
}) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

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
  // The card uses GlassSurface's `translucentStrong` variant — a stronger-
  // translucent backdrop (`surfaceTranslucentStrong`) pinned UNDER the glass, so
  // the card stays see-through but drifts LESS in lightness as the list scrolls.
  // It is the deliberate middle ground between `material` (no backdrop, so the
  // glass samples the live content and drifts most) and an opaque `tint` card.
  // On device that backdrop bump alone was invisible under the live glass's own
  // refraction, so `translucentStrong` also paints a neutral dark `wash` OVER
  // the finished glass — see `GlassSurface`'s `translucentStrong` prop doc for
  // the full mechanism.
  //
  // It also takes `bloom`, per the app-wide bloom rollout — this row is the
  // one place the rollout deliberately keeps its accepted tradeoff explicit:
  // `resolveBackdropFill` checks `bloom` BEFORE `translucentStrong`, so `bloom`
  // WINS on the backdrop — the 0.80-alpha pin is removed and the glass goes
  // back to live-sampling the real scrolling content behind the row (the exact
  // drift `translucentStrong` exists to kill, now knowingly re-admitted here,
  // per product decision, everywhere bloom applies). The dark `surfaceWashStrong`
  // wash is UNCHANGED by this: `resolveWashFill` is driven by `translucentStrong`
  // alone and never reads `bloom`, so it keeps painting over the now-backdrop-
  // less, `'clear'`-effect glass — this is what keeps the row's text legible.
  // COMBINE, not replace: the dark wash stays for legibility; only the
  // anti-drift backdrop pin is traded away for bloom's live sample.
  return (
    <Pressable accessibilityRole="button" onPress={() => onPress(item.id)}>
      <GlassSurface
        translucentStrong
        bloom
        padding={3}
        testID="transaction-row"
        style={styles.rowCard}
      >
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
      </GlassSurface>
    </Pressable>
  );
};

export default memo(TransactionRow);
