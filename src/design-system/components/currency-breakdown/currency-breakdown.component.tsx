import type { FC } from 'react';
import type { Money } from '@kiko/currency/money';

import Box from '../box';
import Text from '../text';
import MoneyText from '../money-text';

import { styles } from './currency-breakdown.styles';
import type { CurrencyBreakdownProps } from './currency-breakdown.props';

// A single currency+amount cell: code on the left, formatted amount on the
// right, aligned across the column via space-between. A long amount shrinks to fit its column, as
// the Statistics pie legend's does, instead of pushing past the column edge.
const BreakdownCell: FC<{ money: Money }> = ({ money }) => {
  return (
    <Box style={styles.cell}>
      <Text variant="caption" tone="textSecondary">
        {money.currency}
      </Text>
      <Box style={styles.value}>
        <MoneyText
          money={money}
          context="balance"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        />
      </Box>
    </Box>
  );
};

// Split the ordered items into two columns, filling row-major (index 0 -> top
// of the left column, 1 -> top of the right, 2 -> next row left, ...), so a
// reader scans left-to-right then down.
const CurrencyBreakdown: FC<CurrencyBreakdownProps> = ({ items }) => {
  const leftColumn = items.filter((_, index) => index % 2 === 0);
  const rightColumn = items.filter((_, index) => index % 2 === 1);

  return (
    <Box style={styles.table}>
      <Box style={styles.column}>
        {leftColumn.map((money) => (
          <BreakdownCell key={money.currency} money={money} />
        ))}
      </Box>
      <Box style={styles.column}>
        {rightColumn.map((money) => (
          <BreakdownCell key={money.currency} money={money} />
        ))}
      </Box>
    </Box>
  );
};

export default CurrencyBreakdown;
