import type { FC } from 'react';
import { type DimensionValue, View } from 'react-native';
import { G, Line, Polyline, Svg } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';

import { chooseCompactUnit, formatCompactMoney } from '../../../currency/compact';
import type { Currency } from '../../../currency/currency';
import { activeLocale } from '../../../i18n/active-locale';
import type { CategoryTrendSeries } from '../../../statistics/category-trend';
import Box from '../box';
import Text from '../text';

import { styles } from './category-trend-line.styles';

/**
 * The per-category spending trend: one line per category, each point that
 * category's total EXPENSE inside one UTC-day bucket (per-period spend, not
 * cumulative), in the base currency's MAJOR units. Every series shares one set
 * of day buckets over the last 30 days on the X axis and a common Y scale rooted
 * at 0. A legend below the plot pairs each line's color with its category title.
 * Renders an empty state when `series` is empty.
 */
type CategoryTrendLineProps = {
  series: CategoryTrendSeries[];
  baseCurrency: Currency;
  height?: number;
  emptyLabel?: string;
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
// A little headroom above the data so the highest line never touches the plot's
// top edge, as a fraction of the value range. Spending has no baseline, so the
// Y scale is rooted at 0 with headroom only at the top.
const VALUE_PADDING_RATIO = 0.1;
// Roughly four ticks across the value range (an inclusive 0..3).
const TICK_COUNT = 4;
// The evenly-spaced fractions of the time range the X-axis labels the timeline
// at: the two extremes plus three interior days, so the axis reads as a real
// timeline rather than just its endpoints.
const X_TICK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
// Half a caption line, to centre a Y tick label on its gridline.
const LABEL_HALF_HEIGHT = 8;

type Scales = {
  x: (t: number) => number;
  y: (value: number) => number;
  minTime: number;
  maxTime: number;
  maxValue: number;
};

// Every point across every series, so the scales and ticks range over all lines
// at once and share one X/Y coordinate space.
const allPointsOf = (series: CategoryTrendSeries[]): CategoryTrendSeries['points'] =>
  series.flatMap((entry) => entry.points);

const buildScales = (series: CategoryTrendSeries[], height: number): Scales => {
  const points = allPointsOf(series);
  const times = points.map((point) => point.t);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeSpan = maxTime - minTime || 1;
  // Rooted at 0 (spending has no baseline); headroom only above the peak.
  const maxValue = Math.max(...points.map((point) => point.amount), 0);
  const valuePad = (maxValue || 1) * VALUE_PADDING_RATIO;
  const paddedSpan = maxValue + valuePad || 1;
  const plotWidth = VIEW_WIDTH - PADDING_X * 2;
  const plotHeight = height - PADDING_Y * 2;

  const x = (t: number): number => PADDING_X + ((t - minTime) / timeSpan) * plotWidth;
  const y = (value: number): number => PADDING_Y + (1 - value / paddedSpan) * plotHeight;

  return { x, y, minTime, maxTime, maxValue };
};

// One Y-axis tick: its value plus a stable key from its fractional position, so
// a flat range (every value equal) still gives each tick a distinct React key.
type Tick = { key: string; value: number };

// The evenly-spaced Y-axis ticks, top (max) to bottom (0), taken from the shared
// 0..max value range so the labels read clean extremes.
const buildTicks = (maxValue: number): Tick[] =>
  Array.from({ length: TICK_COUNT }, (_, index) => {
    const fraction = index / (TICK_COUNT - 1);

    return { key: fraction.toFixed(4), value: maxValue - fraction * maxValue };
  });

// One X-axis (day) tick: its timestamp, its horizontal position as a
// percentage of the plot width (so a label anchors under its gridline), whether
// it is one of the two range extremes (drawn flush to an edge, not centred), and
// — for an edge — whether it is the START extreme (flush left) versus the END
// one (flush right). `isStart` is keyed off the fraction, not `leftPercent === 0`:
// the start's `leftPercent` is the plot's left padding, never exactly 0.
type XTick = { key: string; time: number; leftPercent: number; isEdge: boolean; isStart: boolean };

// The X-axis day ticks across the range. A single-instant range (one bucket,
// or every point at the same time) collapses to a lone start label — the evenly
// spaced set would otherwise stack every day on the same x.
const buildXTicks = (scales: Scales): XTick[] => {
  const timeSpan = scales.maxTime - scales.minTime;
  if (timeSpan <= 0) {
    return [{ key: '0.00', time: scales.minTime, leftPercent: 0, isEdge: true, isStart: true }];
  }

  return X_TICK_FRACTIONS.map((fraction) => {
    const time = scales.minTime + fraction * timeSpan;

    return {
      key: fraction.toFixed(2),
      time,
      leftPercent: (scales.x(time) / VIEW_WIDTH) * 100,
      isEdge: fraction === 0 || fraction === 1,
      isStart: fraction === 0,
    };
  });
};

const toPolylinePoints = (points: CategoryTrendSeries['points'], scales: Scales): string =>
  points.map((point) => `${scales.x(point.t)},${scales.y(point.amount)}`).join(' ');

// The buckets are UTC-midnight instants (`dayBucket` uses `Date.UTC`), so the
// label must format in UTC too — without `timeZone: 'UTC'`, a negative-UTC-
// offset locale renders every label one day early (a UTC-midnight instant is
// still the previous local day there).
const formatAxisTime = (t: number): string =>
  new Date(t).toLocaleDateString(activeLocale(), {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

// The `%` left offset for an interior label, as an RN dimension. Built from a
// runtime number, so it widens to `string` and needs the cast onto the
// percentage side of `DimensionValue`.
const leftPercentOf = (percent: number): DimensionValue => `${percent}%` as DimensionValue;

// The absolute-position style for an X-axis day label: the two range extremes
// flush to the plot's left/right edge, every interior day centred on its
// gridline via a zero-width anchor pinned to that gridline's x.
const xLabelStyle = (tick: XTick) => {
  if (!tick.isEdge) {
    return [styles.xLabelMid, { left: leftPercentOf(tick.leftPercent) }];
  }

  return tick.isStart ? styles.xLabelStart : styles.xLabelEnd;
};

const LegendEntry: FC<{ series: CategoryTrendSeries }> = ({ series }) => {
  return (
    <View testID={`category-trend-line-legend-${series.key}`} style={styles.legendEntry}>
      <View style={[styles.swatch, { backgroundColor: series.color }]} />

      <Text variant="caption" tone="textPrimary">
        {series.title}
      </Text>
    </View>
  );
};

const CategoryTrendLine: FC<CategoryTrendLineProps> = ({
  series,
  baseCurrency,
  height = DEFAULT_HEIGHT,
  emptyLabel,
}) => {
  const { theme } = useUnistyles();

  if (allPointsOf(series).length === 0) {
    return (
      <Box testID="category-trend-line-empty" style={styles.empty(height)}>
        <Text variant="body" tone="textSecondary">
          {emptyLabel}
        </Text>
      </Box>
    );
  }

  const scales = buildScales(series, height);
  const ticks = buildTicks(scales.maxValue);
  const xTicks = buildXTicks(scales);
  // One compact unit for the whole axis, chosen from the spread of tick values
  // so adjacent labels stay distinct while staying short (see chooseCompactUnit).
  const axisUnit = chooseCompactUnit(ticks.map((tick) => tick.value));
  const baselineY = height - PADDING_Y;

  return (
    <Box style={styles.container}>
      <View style={styles.plotRow}>
        <View testID="category-trend-line-y-axis" style={[styles.yAxis, { height }]}>
          {ticks.map((tick, index) => (
            <View
              key={tick.key}
              testID={`category-trend-line-tick-${index}`}
              style={{ position: 'absolute', top: scales.y(tick.value) - LABEL_HALF_HEIGHT }}
            >
              <Text
                variant="caption"
                tone="textSecondary"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {formatCompactMoney(tick.value, baseCurrency, axisUnit, activeLocale())}
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
              {ticks.map((tick, index) => (
                <Line
                  key={tick.key}
                  testID={`category-trend-line-y-grid-${index}`}
                  x1={PADDING_X}
                  y1={scales.y(tick.value)}
                  x2={VIEW_WIDTH - PADDING_X}
                  y2={scales.y(tick.value)}
                  stroke={theme.colors.border}
                  strokeWidth={GRID_STROKE_WIDTH}
                />
              ))}
            </G>

            <G>
              {xTicks
                .filter((tick) => !tick.isEdge)
                .map((tick) => (
                  <Line
                    key={tick.key}
                    testID={`category-trend-line-x-grid-${tick.key}`}
                    x1={scales.x(tick.time)}
                    y1={PADDING_Y}
                    x2={scales.x(tick.time)}
                    y2={baselineY}
                    stroke={theme.colors.border}
                    strokeWidth={GRID_STROKE_WIDTH}
                  />
                ))}
            </G>

            <Line
              testID="category-trend-line-x-axis"
              x1={PADDING_X}
              y1={baselineY}
              x2={VIEW_WIDTH - PADDING_X}
              y2={baselineY}
              stroke={theme.colors.border}
              strokeWidth={GRID_STROKE_WIDTH}
            />

            <G>
              {series.map((entry) => (
                <Polyline
                  key={entry.key}
                  testID={`category-trend-line-line-${entry.key}`}
                  points={toPolylinePoints(entry.points, scales)}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth={LINE_STROKE_WIDTH}
                />
              ))}
            </G>
          </Svg>
        </View>
      </View>

      <View testID="category-trend-line-x-axis-labels" style={styles.xAxis}>
        <View testID="category-trend-line-x-axis-spacer" style={styles.xAxisSpacer} />

        <View style={styles.xAxisTrack}>
          {xTicks.map((tick) => (
            <View
              key={tick.key}
              testID={`category-trend-line-x-tick-${tick.key}`}
              style={xLabelStyle(tick)}
            >
              <Text variant="caption" tone="textSecondary">
                {formatAxisTime(tick.time)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.legend}>
        {series.map((entry) => (
          <LegendEntry key={entry.key} series={entry} />
        ))}
      </View>
    </Box>
  );
};

export default CategoryTrendLine;
