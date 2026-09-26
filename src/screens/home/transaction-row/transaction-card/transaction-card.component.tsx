import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../../design-system/components/box';
import Card from '../../../../design-system/components/card';
import Text from '../../../../design-system/components/text';
import SymbolIcon from '../../../../design-system/components/symbol';
import MoneyText from '../../../../design-system/components/money-text';

import { styles } from './transaction-card.styles';
import type { TransactionCardProps } from './transaction-card.props';

/**
 * The shared transaction card body: the presentational
 * `Card` content Home's `TransactionRow` used to own inline — category icon,
 * title, amount, optional footer captions — extracted so any OTHER preview
 * of "what a transaction looks like" (the statement-import/column-mapping
 * `ExampleTransaction`) renders through the SAME card, not a rebuilt one.
 * `TransactionRow` keeps its own `CardContextMenu`/`Pressable` wrapping and
 * passes this every prop it used to render inline, so Home's own markup is
 * unchanged.
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
