import type { FC } from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Svg, Polyline, Line, G } from 'react-native-svg';
import type { CurrencySeries, SeriesPoint } from '../../../statistics/currency-series';
import Box from '../box';
import Text from '../text';
import { styles } from './line-chart.styles';

/** A currency line chart of indexed percent-change series. Empty when `series=[]`. */
type LineChartProps = { series: CurrencySeries[]; height?: number };

// The logical SVG coordinate space. The plot stretches to the container's real
// width via `width="100%"` + `preserveAspectRatio="none"`; these are the units
// the point/line geometry is computed in, not device pixels.
const VIEW_WIDTH = 320;
const DEFAULT_HEIGHT = 180;
const PADDING_X = 8;
const PADDING_Y = 12;
const SERIES_STROKE_WIDTH = 2;
const GRID_STROKE_WIDTH = 1;
// The fractions of the plot height, top to bottom, that carry a light gridline.
// 0.5 is the 0% baseline and is drawn separately (stronger); these are the two
// quarter lines that frame it.
const GRID_FRACTIONS = [0.25, 0.75] as const;

// The x/y projection from a series point into the logical SVG space, derived
// once from every point across every series so all lines share one frame.
type Scales = { x: (t: number) => number; y: (pct: number) => number; baselineY: number };

const buildScales = (series: CurrencySeries[], height: number): Scales => {
  const points = series.flatMap((line) => line.points);
  const times = points.map((point) => point.t);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeSpan = maxTime - minTime || 1;
  // Symmetric domain around 0 so the baseline sits at the vertical centre; at
  // least 1% so a perfectly flat set of series still spans a sane range.
  const maxAbsPct = Math.max(1, ...points.map((point) => Math.abs(point.pct)));
  const plotWidth = VIEW_WIDTH - PADDING_X * 2;
  const plotHeight = height - PADDING_Y * 2;

  const x = (t: number): number => PADDING_X + ((t - minTime) / timeSpan) * plotWidth;
  const y = (pct: number): number =>
    PADDING_Y + (1 - (pct + maxAbsPct) / (maxAbsPct * 2)) * plotHeight;

  return { x, y, baselineY: y(0) };
};

const toPolylinePoints = (points: SeriesPoint[], scales: Scales): string =>
  points.map((point) => `${scales.x(point.t)},${scales.y(point.pct)}`).join(' ');

// One legend row: the line's colour swatch beside its currency code.
const LegendEntry: FC<{ currency: string; color: string }> = ({ currency, color }) => {
  return (
    <View testID={`line-chart-legend-${currency}`} style={styles.legendEntry}>
      <View style={[styles.swatch, { backgroundColor: color }]} />

      <Text variant="caption" tone="textSecondary">
        {currency}
      </Text>
    </View>
  );
};

const LineChart: FC<LineChartProps> = ({ series, height = DEFAULT_HEIGHT }) => {
  const { theme } = useUnistyles();

  if (series.length === 0) {
    return (
      <Box testID="line-chart-empty" style={styles.empty}>
        <Text variant="body" tone="textSecondary">
          No Data For This Range
        </Text>
      </Box>
    );
  }

  const palette = theme.colors.chartSeries;
  const scales = buildScales(series, height);

  return (
    <Box style={styles.container}>
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        preserveAspectRatio="none"
      >
        <G>
          {GRID_FRACTIONS.map((fraction) => (
            <Line
              key={fraction}
              x1={PADDING_X}
              y1={PADDING_Y + fraction * (height - PADDING_Y * 2)}
              x2={VIEW_WIDTH - PADDING_X}
              y2={PADDING_Y + fraction * (height - PADDING_Y * 2)}
              stroke={theme.colors.border}
              strokeWidth={GRID_STROKE_WIDTH}
            />
          ))}
        </G>

        <Line
          testID="line-chart-baseline"
          x1={PADDING_X}
          y1={scales.baselineY}
          x2={VIEW_WIDTH - PADDING_X}
          y2={scales.baselineY}
          stroke={theme.colors.textSecondary}
          strokeWidth={GRID_STROKE_WIDTH}
        />

        {series.map((line, index) => (
          <Polyline
            key={line.currency}
            testID={`line-chart-series-${line.currency}`}
            points={toPolylinePoints(line.points, scales)}
            fill="none"
            stroke={palette[index % palette.length]}
            strokeWidth={SERIES_STROKE_WIDTH}
          />
        ))}
      </Svg>

      <Box style={styles.legend}>
        {series.map((line, index) => (
          <LegendEntry
            key={line.currency}
            currency={line.currency}
            color={palette[index % palette.length]}
          />
        ))}
      </Box>
    </Box>
  );
};

export default LineChart;
