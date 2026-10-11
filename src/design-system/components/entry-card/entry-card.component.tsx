import type { FC } from 'react';

import Box from '../box';
import Card from '../card';
import Text from '../text';

import { styles } from './entry-card.styles';
import type { EntryCardProps } from './entry-card.props';

/**
 * The shared ledger entry card: a `Card` holding a title and an amount on one row, an optional
 * leading cluster, and right-aligned caption lines beneath. HoldingDetail's ledger rows (a
 * computed entry, a stored transaction) and its upcoming loan payments all render through it,
 * so the three can never drift apart.
 */
const EntryCard: FC<EntryCardProps> = ({
  label,
  amount,
  lead,
  footerLines = [],
  style,
  testID,
}) => {
  const description = (
    <Box style={styles.rowDescription}>
      <Text variant="body">{label}</Text>
    </Box>
  );

  return (
    <Card padding={3} testID={testID} style={style}>
      <Box gap={1}>
        <Box direction="row" style={styles.rowMain}>
          {lead === undefined ? (
            description
          ) : (
            <Box direction="row" gap={2} style={styles.rowLead}>
              {lead}
              {description}
            </Box>
          )}

          <Box style={styles.rowAmount}>{amount}</Box>
        </Box>

        {footerLines.length > 0 && (
          <Box style={styles.rowFooter}>
            {footerLines.map((line) => (
              <Text key={line} variant="caption" tone="textSecondary">
                {line}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </Card>
  );
};

export default EntryCard;
