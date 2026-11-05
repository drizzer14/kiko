import type { FC } from 'react';
import { Pressable } from 'react-native';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import MoneyText from '@kiko/design-system/components/money-text';
import { lastChargeLine, recurrenceLine } from '@kiko/recurring/recurrence-text';

import { styles } from './recurring-series-row.styles';
import type { RecurringSeriesRowProps } from './recurring-series-row.props';

const RecurringSeriesRow: FC<RecurringSeriesRowProps> = ({ series, onPress }) => {
  const { t } = useTranslation();

  return (
    <Pressable accessibilityRole="button" onPress={() => onPress(series)}>
      <Card padding={3} testID={`recurring-series-row-${series.id}`}>
        <Box direction="row" style={styles.main}>
          <Box gap={1} style={styles.lines}>
            <Text variant="body">{series.name}</Text>

            <Text variant="caption" tone="textSecondary">
              {recurrenceLine(series.period, series.recurrence, t)}
            </Text>

            <Text variant="caption" tone="textSecondary">
              {lastChargeLine(series, t)}
            </Text>
          </Box>

          <Box style={styles.amount}>
            <MoneyText money={Money.of(series.currency, series.lastChargeAmountMinorUnits)} />
          </Box>
        </Box>
      </Card>
    </Pressable>
  );
};

export default RecurringSeriesRow;
