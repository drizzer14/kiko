import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Rect, Svg } from 'react-native-svg';
import { match } from 'ts-pattern';

import type { Currency } from '../../../currency/currency';
import { Money } from '../../../currency/money';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import type { HoldingType } from '../../../holdings/holding-type';
import type { TypeSlice } from '../../../statistics/type-breakdown';
import Box from '../box';
import MoneyText from '../money-text';
import Text from '../text';

import { styles } from './bar-chart.styles';

/**
 * A horizontal by-type bar chart. Each entry's `amount` is the type's total in
 * the base currency's MINOR units; entries arrive already sorted descending.
 * Empty when `data=[]`.
 */
type BarChartProps = { data: TypeSlice[]; baseCurrency: Currency; height?: number };

// The logical SVG width the bar geometry is computed in; the plot stretches to
// the container's real width via `width="100%"` + `preserveAspectRatio="none"`.
const VIEW_WIDTH = 320;
// The thickness of a single bar, in the same logical units.
const BAR_THICKNESS = 14;
const BAR_RADIUS = 4;

// Human display text for the id-like holding types, so a bar reads "Deposit"
// rather than "term_deposit" — matched against the existing forms.* catalog
// keys (the same wording the holding-kind picker uses), via ts-pattern so a
// new HoldingType fails this `exhaustive()` at compile time instead of
// silently falling through, and each key is a literal `t()` calls tsc checks.
const holdingTypeLabel = (type: HoldingType, t: ReturnType<typeof useTranslation>['t']): string =>
  match(type)
    .with('card', () => t('forms.holding.card'))
    .with('term_deposit', () => t('forms.holding.deposit'))
    .with('bond', () => t('forms.holding.bond'))
    .with('cash', () => t('forms.account.cash'))
    .with('crypto_asset', () => t('forms.holding.cryptoAsset'))
    .with('jar', () => t('forms.holding.jar'))
    .exhaustive();

// One bar row: the type name and its converted amount above a bar whose width
// is proportional to `amount / max`.
const BarRow: FC<{ slice: TypeSlice; baseCurrency: Currency; max: number; color: string }> = ({
  slice,
  baseCurrency,
  max,
  color,
}) => {
  const { t } = useTranslation();
  // `max` is the largest entry (data is sorted desc, so `data[0]`), guarded
  // non-zero by the caller; the widest bar therefore fills the plot exactly.
  const width = (slice.amount / max) * VIEW_WIDTH;

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View testID={`bar-chart-label-${slice.type}`}>
          <Text variant="body" tone="textPrimary">
            {holdingTypeLabel(slice.type, t)}
          </Text>
        </View>

        <MoneyText money={Money.of(baseCurrency, slice.amount)} context="balance" />
      </View>

      <Svg
        width="100%"
        height={BAR_THICKNESS}
        viewBox={`0 0 ${VIEW_WIDTH} ${BAR_THICKNESS}`}
        preserveAspectRatio="none"
      >
        <Rect
          testID={`bar-chart-bar-${slice.type}`}
          x={0}
          y={0}
          width={width}
          height={BAR_THICKNESS}
          rx={BAR_RADIUS}
          fill={color}
        />
      </Svg>
    </View>
  );
};

const BarChart: FC<BarChartProps> = ({ data, baseCurrency }) => {
  const { t } = useTranslation();

  if (data.length === 0) {
    return (
      <Box testID="bar-chart-empty" style={styles.empty}>
        <Text variant="body" tone="textSecondary">
          {t('common.noDataForRange')}
        </Text>
      </Box>
    );
  }

  // Data is sorted descending, so the first entry is the largest.
  const max = data[0].amount;

  return (
    <Box style={styles.container}>
      {data.map((slice) => (
        <BarRow
          key={slice.type}
          slice={slice}
          baseCurrency={baseCurrency}
          max={max}
          // Match the holding cards: each type's bar wears the same entity color
          // its holdings do, keyed off the slice's type.
          color={defaultHoldingColor[slice.type]}
        />
      ))}
    </Box>
  );
};

export default BarChart;
