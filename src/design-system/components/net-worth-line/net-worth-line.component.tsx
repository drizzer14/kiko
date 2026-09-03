import type { FC } from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Svg, Polyline, Line, G } from 'react-native-svg';
import type { Currency } from '../../../currency/currency';
import { formatMoney } from '../../../currency/format';
import { Money } from '../../../currency/money';
import type { NetWorthPoint } from '../../../statistics/net-worth-series';
import Box from '../box';
import Text from '../text';
import { styles } from './net-worth-line.styles';

/**
 * The converted net-worth line over time. Each point's `amount` is total net
 * worth in the base currency's MAJOR units; `startReference` is the range-start
 * value the chart draws as a dashed baseline. Shows a loading state while the
 * history backfill is still running (`loading` with no points), and an empty
 * state when there is nothing to draw.
 */
type NetWorthLineProps = {
  points: NetWorthPoint[];
  startReference: number;
  baseCurrency: Currency;
  loading?: boolean;
  height?: number;
};

// The logical SVG coordinate space. The plot stretches to the container's real
// width via `width="100%"` + `preserveAspectRatio="none"`; these are the units
// the geometry is computed in, not device pixels. Its height matches the
// rendered pixel height so the Y-axis labels beside it line up vertically.
const VIEW_WIDTH = 320;
const DEFAULT_HEIGHT = 200;
const PADDING_X = 8;
const PADDING_Y = 12;
const LINE_STROKE_WIDTH = 2;
const GRID_STROKE_WIDTH = 1;
// A little headroom above/below the data so the line never touches the plot's
// top or bottom edge, as a fraction of the value range.
const VALUE_PADDING_RATIO = 0.1;
// Roughly four ticks across the value range (an inclusive 0..3).
const TICK_COUNT = 4;
// The dashed pattern for the start-reference baseline.
const REFERENCE_DASH = '4 4';
// Half a caption line, to centre a Y tick label on its gridline.
const LABEL_HALF_HEIGHT = 8;

type Scales = { x: (t: number) => number; y: (value: number) => number };

const buildScales = (points: NetWorthPoint[], startReference: number, height: number): Scales => {
  const times = points.map((point) => point.t);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeSpan = maxTime - minTime || 1;
  // Include the reference so the dashed baseline always falls on-screen.
  const values = [...points.map((point) => point.amount), startReference];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valuePad = (maxValue - minValue || 1) * VALUE_PADDING_RATIO;
  const paddedMin = minValue - valuePad;
  const paddedSpan = maxValue - minValue + valuePad * 2 || 1;
  const plotWidth = VIEW_WIDTH - PADDING_X * 2;
  const plotHeight = height - PADDING_Y * 2;

  const x = (t: number): number => PADDING_X + ((t - minTime) / timeSpan) * plotWidth;
  const y = (value: number): number =>
    PADDING_Y + (1 - (value - paddedMin) / paddedSpan) * plotHeight;

  return { x, y };
};

// One Y-axis tick: its value plus a stable key from its fractional position, so
// a flat range (every value equal) still gives each tick a distinct React key.
type Tick = { key: string; value: number };

// The evenly-spaced Y-axis ticks, top (max) to bottom (min), taken from the true
// data-and-reference range so the labels read clean extremes.
const buildTicks = (points: NetWorthPoint[], startReference: number): Tick[] => {
  const values = [...points.map((point) => point.amount), startReference];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  return Array.from({ length: TICK_COUNT }, (_, index) => {
    const fraction = index / (TICK_COUNT - 1);

    return { key: fraction.toFixed(4), value: maxValue - fraction * (maxValue - minValue) };
  });
};

const toPolylinePoints = (points: NetWorthPoint[], scales: Scales): string =>
  points.map((point) => `${scales.x(point.t)},${scales.y(point.amount)}`).join(' ');

const formatAxisTime = (t: number): string =>
  new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const StatusMessage: FC<{ testID: string; message: string }> = ({ testID, message }) => {
  return (
    <Box testID={testID} style={styles.status}>
      <Text variant="body" tone="textSecondary">
        {message}
      </Text>
    </Box>
  );
};

const NetWorthLine: FC<NetWorthLineProps> = ({
  points,
  startReference,
  baseCurrency,
  loading = false,
  height = DEFAULT_HEIGHT,
}) => {
  const { theme } = useUnistyles();

  if (points.length === 0) {
    return loading ? (
      <StatusMessage testID="net-worth-line-loading" message="Loading History" />
    ) : (
      <StatusMessage testID="net-worth-line-empty" message="No Data For This Range" />
    );
  }

  const scales = buildScales(points, startReference, height);
  const ticks = buildTicks(points, startReference);
  const referenceY = scales.y(startReference);
  const baselineY = height - PADDING_Y;

  return (
    <Box style={styles.container}>
      <View style={styles.plotRow}>
        <View style={[styles.yAxis, { height }]}>
          {ticks.map((tick, index) => (
            <View
              key={tick.key}
              testID={`net-worth-line-tick-${index}`}
              style={{ position: 'absolute', top: scales.y(tick.value) - LABEL_HALF_HEIGHT }}
            >
              <Text variant="caption" tone="textSecondary">
                {formatMoney(Money.fromMajor(baseCurrency, tick.value))}
              </Text>
            </View>
          ))}
        </View>

        <View style={[styles.plot, { height }]}>
          <Svg
            width="100%"
            height={height}
            viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
            preserveAspectRatio="none"
          >
            <G>
              {ticks.map((tick) => (
                <Line
                  key={tick.key}
                  x1={PADDING_X}
                  y1={scales.y(tick.value)}
                  x2={VIEW_WIDTH - PADDING_X}
                  y2={scales.y(tick.value)}
                  stroke={theme.colors.border}
                  strokeWidth={GRID_STROKE_WIDTH}
                />
              ))}
            </G>

            <Line
              testID="net-worth-line-x-axis"
              x1={PADDING_X}
              y1={baselineY}
              x2={VIEW_WIDTH - PADDING_X}
              y2={baselineY}
              stroke={theme.colors.border}
              strokeWidth={GRID_STROKE_WIDTH}
            />

            <Line
              testID="net-worth-line-reference"
              x1={PADDING_X}
              y1={referenceY}
              x2={VIEW_WIDTH - PADDING_X}
              y2={referenceY}
              stroke={theme.colors.textSecondary}
              strokeWidth={GRID_STROKE_WIDTH}
              strokeDasharray={REFERENCE_DASH}
            />

            <Polyline
              testID="net-worth-line-polyline"
              points={toPolylinePoints(points, scales)}
              fill="none"
              stroke={theme.colors.accent}
              strokeWidth={LINE_STROKE_WIDTH}
            />
          </Svg>
        </View>
      </View>

      <View style={styles.xAxis}>
        <Text variant="caption" tone="textSecondary">
          {formatAxisTime(points[0].t)}
        </Text>

        <Text variant="caption" tone="textSecondary">
          {formatAxisTime(points[points.length - 1].t)}
        </Text>
      </View>
    </Box>
  );
};

export default NetWorthLine;
