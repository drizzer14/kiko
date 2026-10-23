import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Card from '../card';
import Text from '../text';
import SymbolIcon from '../symbol';

import { styles } from './entry-card.styles';
import type { EntryCardProps } from './entry-card.props';

/**
 * The shared ledger entry card: a `Card` holding a title and an amount on one row, an optional
 * leading cluster, a caption directly under the amount, and right-aligned footer lines beneath
 * the whole row. HoldingDetail's ledger rows (a
 * computed entry, a stored transaction) and its upcoming loan payments all render through it,
 * so the three can never drift apart.
 */
const EntryCard: FC<EntryCardProps> = ({
  label,
  amount,
  lead,
  amountCaption,
  amountCaptionIcon,
  footerLines = [],
  style,
  testID,
}) => {
  const { theme } = useUnistyles();
  const hasAmountCaption = amountCaption !== undefined || amountCaptionIcon !== undefined;
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

          <Box gap={1} style={styles.rowAmount}>
            {amount}

            {hasAmountCaption && (
              <Box direction="row" gap={1} style={styles.amountCaption}>
                {amountCaptionIcon !== undefined && (
                  <SymbolIcon
                    name={amountCaptionIcon.name}
                    size={theme.iconSizes.caption}
                    tone="textSecondary"
                    testID={amountCaptionIcon.testID}
                  />
                )}
                {amountCaption !== undefined && (
                  <Text variant="caption" tone="textSecondary">
                    {amountCaption}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        </Box>

        {footerLines.length > 0 && (
          <Box style={styles.rowFooter}>
            {footerLines.map((line) => (
              <Text key={line} variant="caption" tone="textSecondary" style={styles.rowFooterLine}>
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
