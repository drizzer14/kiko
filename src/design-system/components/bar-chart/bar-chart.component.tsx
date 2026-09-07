import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Rect, Svg } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';
import { match } from 'ts-pattern';

import type { Currency } from '../../../currency/currency';
import { Money } from '../../../currency/money';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import type { HoldingType } from '../../../holdings/holding-type';
import type { TypeSlice } from '../../../statistics/type-breakdown';
import { resolveColorScheme } from '../../color-scheme';
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
// is proportional to `abs(amount) / scale`.
const BarRow: FC<{ slice: TypeSlice; baseCurrency: Currency; scale: number; color: string }> = ({
  slice,
  baseCurrency,
  scale,
  color,
}) => {
  const { t } = useTranslation();
  // Clamped into the plot: the magnitude scale below already keeps the ratio
  // in [0, 1], and the clamp makes a future mis-scaled value structurally
  // incapable of producing an invisible (negative-width) or overflowing bar.
  const width = Math.min(Math.max((Math.abs(slice.amount) / scale) * VIEW_WIDTH, 0), VIEW_WIDTH);

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
  // The active color scheme, read once so each bar's type-default color resolves
  // from the matching light/dark entity set (see color-scheme.ts / palette.ts).
  const { rt } = useUnistyles();
  const holdingDefaults = defaultHoldingColor(resolveColorScheme(rt.themeName));

  if (data.length === 0) {
    return (
      <Box testID="bar-chart-empty" style={styles.empty}>
        <Text variant="body" tone="textSecondary">
          {t('common.noDataForRange')}
        </Text>
      </Box>
    );
  }

  // Scale against the largest MAGNITUDE, not the largest signed value. `data`
  // is sorted descending and `buildTypeBreakdown` keeps negatives (an
  // overdrawn Monobank credit card writes `account.balance` verbatim), so
  // `data[0].amount` could be a negative maximum — which made every bar's
  // `amount / max` ratio >= 1 and rendered them all full-width, and made a
  // single negative slice among positives a NEGATIVE width that
  // CGPathAddRoundedRect silently drew as nothing while the money label still
  // read the real figure. Guarded non-zero: `buildTypeBreakdown` filters
  // `amount !== 0`, but an empty-after-filter list is handled above and a
  // defensive `|| 1` keeps the division total.
  const scale = Math.max(...data.map((slice) => Math.abs(slice.amount))) || 1;

  return (
    <Box style={styles.container}>
      {data.map((slice) => (
        <BarRow
          key={slice.type}
          slice={slice}
          baseCurrency={baseCurrency}
          scale={scale}
          // Match the holding cards: each type's bar wears the same entity color
          // its holdings do, keyed off the slice's type.
          color={holdingDefaults[slice.type]}
        />
      ))}
    </Box>
  );
};

export default BarChart;
