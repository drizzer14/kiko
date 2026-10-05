import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Card from '../card';
import Text from '../text';
import SymbolIcon from '../symbol';
import MoneyText from '../money-text';

import { styles } from './transaction-card.styles';
import type { TransactionCardProps } from './transaction-card.props';

/**
 * The shared transaction card body: the presentational `Card` content —
 * category icon, title, amount, optional footer captions — shared so any
 * OTHER preview of "what a transaction looks like" (the
 * statement-import/column-mapping `ExampleTransaction`) renders through the
 * SAME card, not a rebuilt one. Home's `TransactionRow` owns its own
 * `CardContextMenu`/`Pressable` wrapping and passes this every prop it
 * renders.
 */
const TransactionCard: FC<TransactionCardProps> = ({
  title,
  categoryIcon,
  categoryIconColor,
  categoryAccessibilityLabel,
  money,
  footerMeta,
  footerTrailing,
  loanLinked,
  style,
  testID,
}) => {
  const { theme } = useUnistyles();
  const hasFooter = footerMeta !== undefined || footerTrailing !== undefined || loanLinked === true;

  return (
    <Card padding={3} testID={testID} style={style}>
      <Box gap={2}>
        <Box direction="row" style={styles.rowMain}>
          <Box direction="row" gap={2} style={styles.rowLead}>
            <SymbolIcon
              name={categoryIcon}
              size={theme.iconSizes.body}
              tone="textSecondary"
              color={categoryIconColor}
              accessibilityLabel={categoryAccessibilityLabel}
            />
            <Box style={styles.rowDescription}>
              <Text variant="body">{title}</Text>
            </Box>
          </Box>
          <Box style={styles.rowAmount}>
            <MoneyText money={money} context="transaction" />
          </Box>
        </Box>

        {hasFooter && (
          <Box direction="row" gap={2} style={styles.rowFooter}>
            <Box direction="row" gap={1} style={styles.rowFooterMeta}>
              {loanLinked === true && (
                <SymbolIcon name="link" size={theme.iconSizes.caption} tone="textSecondary" />
              )}
              {footerMeta !== undefined && (
                <Text variant="caption" tone="textSecondary">
                  {footerMeta}
                </Text>
              )}
            </Box>

            {footerTrailing !== undefined && (
              <Text variant="caption" tone="textSecondary">
                {footerTrailing}
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Card>
  );
};

export default TransactionCard;
