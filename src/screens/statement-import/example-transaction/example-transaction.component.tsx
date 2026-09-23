import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import { Money } from '../../../currency/money';
import { formatDate } from '../../../dates/format';
import MoneyText from '../../../design-system/components/money-text';

import { styles } from './example-transaction.styles';
import type { ExampleTransactionProps } from './example-transaction.props';

/**
 * ONE shared row previewing the first parsed transaction — device-feedback-
 * round-F1 items 9/14: shown under the summary table on both
 * `statement-import.screen.tsx` and the column-mapping result section, so the
 * user sees a real example of what will actually be written BEFORE tapping
 * Import. Date left, description below it, amount right — the same
 * lead/trailing row shape the holding-detail ledger row uses.
 */
const ExampleTransaction: FC<ExampleTransactionProps> = ({ transaction, testID }) => {
  const { t } = useTranslation();

  return (
    <Box gap={1} testID={testID}>
      <Text variant="caption" tone="textSecondary">
        {t('statementImport.exampleTransaction')}
      </Text>

      <Box direction="row" style={styles.row}>
        <Box style={styles.lead}>
          <Text variant="body" numberOfLines={1}>
            {formatDate(transaction.timeSeconds * 1000)}
          </Text>
          <Text variant="caption" tone="textSecondary" numberOfLines={1}>
            {transaction.description}
          </Text>
        </Box>

        <MoneyText money={Money.of(transaction.currency, transaction.amountMinorUnits)} />
      </Box>
    </Box>
  );
};

export default ExampleTransaction;
