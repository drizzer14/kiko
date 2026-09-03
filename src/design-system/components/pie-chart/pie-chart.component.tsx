import type { FC } from 'react';
import { View } from 'react-native';
import { Svg, Path } from 'react-native-svg';
import type { Currency } from '../../../currency/currency';
import { Money } from '../../../currency/money';
import type { AccountSlice } from '../../../statistics/account-contribution';
import Box from '../box';
import Text from '../text';
import MoneyText from '../money-text';
import { styles } from './pie-chart.styles';

/** A donut of per-account net-worth contribution. Empty when `slices=[]`. */
type PieChartProps = { slices: AccountSlice[]; baseCurrency: Currency; size?: number };

const DEFAULT_SIZE = 200;
// The donut hole as a fraction of the outer radius — 0 would be a full pie.
const INNER_RATIO = 0.58;
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
const donutArc = (center: number, outerRadius: number, arc: ArcSlice): string => {
  const innerRadius = outerRadius * INNER_RATIO;
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

const toPercent = (share: number): string => `${Math.round(share * 100)}%`;

// One legend row, laid out as three aligned table columns: the swatch + account
// name fills the remaining width on the left, then a fixed-width right-aligned
// value column, then a fixed-width right-aligned percent column — so the figures
// line up vertically down the list regardless of magnitude. The swatch wears the
// slice's own entity color, matching its pie arc and the account card.
const PieLegendEntry: FC<{ slice: AccountSlice; baseCurrency: Currency }> = ({
  slice,
  baseCurrency,
}) => {
  return (
    <View testID={`pie-chart-legend-${slice.accountId}`} style={styles.legendRow}>
      <View style={styles.legendName}>
        <View
          testID={`pie-chart-swatch-${slice.accountId}`}
          style={[styles.swatch, { backgroundColor: slice.color }]}
        />

        <Text variant="body" tone="textPrimary">
          {slice.name}
        </Text>
      </View>

      <View testID={`pie-chart-legend-value-${slice.accountId}`} style={styles.legendValue}>
        <MoneyText
          money={Money.of(baseCurrency, slice.amount)}
          context="balance"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        />
      </View>

      <View testID={`pie-chart-legend-percent-${slice.accountId}`} style={styles.legendPercent}>
        <Text variant="caption" tone="textSecondary">
          {toPercent(slice.share)}
        </Text>
      </View>
    </View>
  );
};

const PieChart: FC<PieChartProps> = ({ slices, baseCurrency, size = DEFAULT_SIZE }) => {
  if (slices.length === 0) {
    return (
      <Box testID="pie-chart-empty" style={styles.empty}>
        <Text variant="body" tone="textSecondary">
          No Accounts To Show
        </Text>
      </Box>
    );
  }

  const center = size / 2;
  const arcs = withAngles(slices);

  return (
    <Box style={styles.container}>
      <View style={styles.chart}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {arcs.map((arc) => (
            <Path
              key={arc.accountId}
              testID={`pie-chart-arc-${arc.accountId}`}
              d={donutArc(center, center, arc)}
              fill={arc.color}
            />
          ))}
        </Svg>
      </View>

      <Box style={styles.legend}>
        {slices.map((slice) => (
          <PieLegendEntry key={slice.accountId} slice={slice} baseCurrency={baseCurrency} />
        ))}
      </Box>
    </Box>
  );
};

export default PieChart;
