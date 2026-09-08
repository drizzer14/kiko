import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Path, Svg } from 'react-native-svg';

import type { Currency } from '../../../currency/currency';
import { Money } from '../../../currency/money';
import type { AccountSlice } from '../../../statistics/account-contribution';
import Box from '../box';
import MoneyText from '../money-text';
import Text from '../text';

import { styles } from './pie-chart.styles';

/**
 * A donut of per-slice contribution. Empty when `slices=[]`. `testID` prefixes
 * every rendered primitive (arc, legend row, empty state), so two pies on one
 * screen — the account-contribution pie and the category-spending pie — never
 * collide on the same hardcoded id; it defaults to `pie-chart`. `emptyLabel` is
 * the empty-state copy, defaulting to the account-pie wording. `innerRatio`
 * overrides the default ring thickness (see `DEFAULT_INNER_RATIO`) — a caller
 * that needs room for a `centerTotal` passes a higher ratio to thin the ring.
 * `centerTotal`, when supplied, renders that amount centered in the donut
 * hole (e.g. the category-spending donut's total); omitted, no center total
 * renders — the account-contribution pie's total already reads elsewhere on
 * screen, so it passes neither.
 */
type PieChartProps = {
  slices: AccountSlice[];
  baseCurrency: Currency;
  size?: number;
  testID?: string;
  emptyLabel?: string;
  innerRatio?: number;
  centerTotal?: Money;
};

const DEFAULT_SIZE = 200;
const DEFAULT_TEST_ID = 'pie-chart';
// The donut hole as a fraction of the outer radius — 0 would be a full pie.
const DEFAULT_INNER_RATIO = 0.58;
const FULL_TURN = 360;
// A single full-circle slice (share ~1) would collapse an SVG arc to a
// zero-length command (start point == end point), rendering nothing; cap the
// sweep just short of a full turn so the ring still closes visibly.
const MAX_SWEEP = 359.999;

// A slice with its resolved start/end angles (degrees, clockwise from 12
// o'clock), so each arc knows where the cumulative wedge before it ended.
type ArcSlice = AccountSlice & { startAngle: number; endAngle: number };

const withAngles = (slices: AccountSlice[]): ArcSlice[] => {
  let cursor = 0;

  return slices.map((slice) => {
    const startAngle = cursor * FULL_TURN;
    cursor += slice.share;
    const endAngle = startAngle + Math.min(slice.share * FULL_TURN, MAX_SWEEP);

    return { ...slice, startAngle, endAngle };
  });
};

// A point on a circle of radius `radius` at `angleDeg`, measured clockwise from
// 12 o'clock (so 0deg is the top), in the SVG's y-down coordinate space.
const polarToCartesian = (center: number, radius: number, angleDeg: number) => {
  const radians = ((angleDeg - 90) * Math.PI) / 180;

  return { x: center + radius * Math.cos(radians), y: center + radius * Math.sin(radians) };
};

// The `d` for one donut wedge: outer arc forward, line in to the hole, inner
// arc back, closed. `largeArc` flips once a wedge passes the half-circle mark.
const donutArc = (
  center: number,
  outerRadius: number,
  arc: ArcSlice,
  innerRatio: number,
): string => {
  const innerRadius = outerRadius * innerRatio;
  const largeArc = arc.endAngle - arc.startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(center, outerRadius, arc.startAngle);
  const outerEnd = polarToCartesian(center, outerRadius, arc.endAngle);
  const innerEnd = polarToCartesian(center, innerRadius, arc.endAngle);
  const innerStart = polarToCartesian(center, innerRadius, arc.startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
};

/**
 * Whole-percent labels for a set of shares, allocated by largest remainder
 * (the Hare quota): floor each share, then hand the leftover points to the
 * slices with the biggest discarded fractions.
 *
 * Rounding each slice INDEPENDENTLY with `Math.round(share * 100)` made the
 * column under the ring sum to 99 or 101 — three equal thirds read 33/33/33,
 * and `[0.5, 0.25, 0.125, 0.125]` read 50/25/13/13. The allocation has to see
 * the whole set at once, so it happens here, once, rather than per legend row.
 *
 * Ties on the remainder are broken by index, so the labels are stable across
 * renders for an unchanged slice order.
 */
const allocatePercents = (shares: readonly number[]): number[] => {
  const exact = shares.map((share) => share * 100);
  const floors = exact.map((value) => Math.floor(value));
  const allocated = floors.reduce((sum, value) => sum + value, 0);
  const remainder = Math.round(exact.reduce((sum, value) => sum + value, 0)) - allocated;

  const order = exact
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];

  for (let step = 0; step < remainder; step += 1) {
    const target = order[step % order.length];
    result[target.index] += 1;
  }

  return result;
};

// One legend row, laid out as three aligned table columns: the swatch + account
// name fills the remaining width on the left, then a fixed-width right-aligned
// value column, then a fixed-width right-aligned percent column — so the figures
// line up vertically down the list regardless of magnitude. The swatch wears the
// slice's own entity color, matching its pie arc and the account card.
const PieLegendEntry: FC<{
  slice: AccountSlice;
  baseCurrency: Currency;
  testID: string;
  percent: number;
}> = ({ slice, baseCurrency, testID, percent }) => {
  return (
    <View testID={`${testID}-legend-${slice.accountId}`} style={styles.legendRow}>
      <View style={styles.legendName}>
        <View
          testID={`${testID}-swatch-${slice.accountId}`}
          style={[styles.swatch, { backgroundColor: slice.color }]}
        />

        <Text variant="body" tone="textPrimary">
          {slice.name}
        </Text>
      </View>

      <View testID={`${testID}-legend-value-${slice.accountId}`} style={styles.legendValue}>
        <MoneyText
          money={Money.of(baseCurrency, slice.amount)}
          context="balance"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        />
      </View>

      <View testID={`${testID}-legend-percent-${slice.accountId}`} style={styles.legendPercent}>
        <Text variant="caption" tone="textSecondary">
          {`${percent}%`}
        </Text>
      </View>
    </View>
  );
};

const PieChart: FC<PieChartProps> = ({
  slices,
  baseCurrency,
  size = DEFAULT_SIZE,
  testID = DEFAULT_TEST_ID,
  emptyLabel,
  innerRatio = DEFAULT_INNER_RATIO,
  centerTotal,
}) => {
  const { t } = useTranslation();

  if (slices.length === 0) {
    return (
      <Box testID={`${testID}-empty`} style={styles.empty}>
        <Text variant="body" tone="textSecondary">
          {emptyLabel ?? t('components.pieChart.emptyDefault')}
        </Text>
      </Box>
    );
  }

  const center = size / 2;
  const arcs = withAngles(slices);
  const percents = allocatePercents(slices.map((slice) => slice.share));

  return (
    <Box style={styles.container}>
      <View style={styles.chart}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {arcs.map((arc) => (
            <Path
              key={arc.accountId}
              testID={`${testID}-arc-${arc.accountId}`}
              d={donutArc(center, center, arc, innerRatio)}
              fill={arc.color}
            />
          ))}
        </Svg>

        {centerTotal !== undefined && (
          <View
            testID={`${testID}-center-total`}
            pointerEvents="none"
            style={[styles.centerTotal, { width: size, height: size }]}
          >
            <MoneyText
              money={centerTotal}
              context="balance"
              style={styles.centerAmount}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            />
          </View>
        )}
      </View>

      <Box style={styles.legend}>
        {slices.map((slice, index) => (
          <PieLegendEntry
            key={slice.accountId}
            slice={slice}
            baseCurrency={baseCurrency}
            testID={testID}
            percent={percents[index]}
          />
        ))}
      </Box>
    </Box>
  );
};

export default PieChart;
