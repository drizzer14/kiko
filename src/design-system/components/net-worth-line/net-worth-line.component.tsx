import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { type DimensionValue, View } from 'react-native';
import { G, Line, Polyline, Svg } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';

import { chooseCompactUnit, formatCompactMoney } from '../../../currency/compact';
import type { Currency } from '../../../currency/currency';
import { activeLocale } from '../../../i18n/active-locale';
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
// The evenly-spaced fractions of the time range the X-axis labels the timeline
// at: the two extremes plus three interior dates, so the axis reads as a real
// timeline rather than just its endpoints.
const X_TICK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
// The dashed pattern for the start-reference baseline.
const REFERENCE_DASH = '4 4';
// Half a caption line, to centre a Y tick label on its gridline.
const LABEL_HALF_HEIGHT = 8;

type Scales = {
  x: (t: number) => number;
  y: (value: number) => number;
  minTime: number;
  maxTime: number;
};

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

  return { x, y, minTime, maxTime };
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

// One X-axis (time) tick: its timestamp, its horizontal position as a percentage
// of the plot width (so a label anchors under its gridline), whether it is one of
// the two range extremes (drawn flush to an edge, not centred), and — for an edge
// — whether it is the START extreme (flush left) versus the END one (flush
// right). `isStart` is keyed off the fraction, not `leftPercent === 0`: the
// start's `leftPercent` is the plot's left padding (PADDING_X / VIEW_WIDTH), never
// exactly 0, so a `=== 0` test would misclassify the start as the end and stack
// both range labels at the right edge.
type XTick = { key: string; time: number; leftPercent: number; isEdge: boolean; isStart: boolean };

// The X-axis time ticks across the range. A single-instant range (one point, or
// every point at the same time) collapses to a lone start label — the evenly
// spaced set would otherwise stack every date on the same x.
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

const toPolylinePoints = (points: NetWorthPoint[], scales: Scales): string =>
  points.map((point) => `${scales.x(point.t)},${scales.y(point.amount)}`).join(' ');

const formatAxisTime = (t: number): string =>
  new Date(t).toLocaleDateString(activeLocale(), { month: 'short', day: 'numeric' });

// The `%` left offset for an interior label, as an RN dimension. Built from a
// runtime number, so it widens to `string` and needs the cast onto the
// percentage side of `DimensionValue`.
const leftPercentOf = (percent: number): DimensionValue => `${percent}%` as DimensionValue;

// The absolute-position style for an X-axis date label: the two range extremes
// flush to the plot's left/right edge, every interior date centred on its
// gridline via a zero-width anchor pinned to that gridline's x.
const xLabelStyle = (tick: XTick) => {
  if (!tick.isEdge) {
    return [styles.xLabelMid, { left: leftPercentOf(tick.leftPercent) }];
  }

  return tick.isStart ? styles.xLabelStart : styles.xLabelEnd;
};

const StatusMessage: FC<{ testID: string; message: string; height: number }> = ({
  testID,
  message,
  height,
}) => {
  return (
    <Box testID={testID} style={styles.status(height)}>
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
  // formatAxisTime and formatCompactMoney below both read activeLocale() at
  // render/call time, not via a subscription of their own (formatAxisTime is
  // a module-scope helper). Subscribing here, the same as MoneyText, is what
  // makes a language switch actually re-render this component's axis labels
  // instead of leaving them stale until some other prop change forces it.
  const { t } = useTranslation();

  if (points.length === 0) {
    return loading ? (
      <StatusMessage
        testID="net-worth-line-loading"
        message={t('components.netWorthLine.loadingHistory')}
        height={height}
      />
    ) : (
      <StatusMessage
        testID="net-worth-line-empty"
        message={t('common.noDataForRange')}
        height={height}
      />
    );
  }

  const scales = buildScales(points, startReference, height);
  const ticks = buildTicks(points, startReference);
  const xTicks = buildXTicks(scales);
  // One compact unit for the whole axis, chosen from the spread of tick values
  // so adjacent labels stay distinct while staying short (see chooseCompactUnit).
  const axisUnit = chooseCompactUnit(ticks.map((tick) => tick.value));
  const referenceY = scales.y(startReference);
  const baselineY = height - PADDING_Y;

  return (
    <Box style={styles.container}>
      <View style={styles.plotRow}>
        <View testID="net-worth-line-y-axis" style={[styles.yAxis, { height }]}>
          {ticks.map((tick, index) => (
            <View
              key={tick.key}
              testID={`net-worth-line-tick-${index}`}
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

            <G>
              {xTicks
                .filter((tick) => !tick.isEdge)
                .map((tick) => (
                  <Line
                    key={tick.key}
                    testID={`net-worth-line-x-grid-${tick.key}`}
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
              stroke={theme.colors.entityColors.white}
              strokeWidth={LINE_STROKE_WIDTH}
            />
          </Svg>
        </View>
      </View>

      <View testID="net-worth-line-x-axis-labels" style={styles.xAxis}>
        {/* Mirror the plot row above: a fixed-width spacer standing in for the
            Y-axis label column, then a flex:1 track that lines up exactly with
            the SVG plot. The interior labels position by a percentage `left`
            inside this track — and a flex:1 child has a definite laid-out width
            (the same way the plot's own SVG does), so those percentages resolve
            on device instead of collapsing to 0 and stacking every intermediate
            date at the track's left edge (the bug this fixes). A plain marginLeft
            on a row of only-absolute children gave the track no such width. */}
        <View testID="net-worth-line-x-axis-spacer" style={styles.xAxisSpacer} />

        <View style={styles.xAxisTrack}>
          {xTicks.map((tick) => (
            <View
              key={tick.key}
              testID={`net-worth-line-x-tick-${tick.key}`}
              style={xLabelStyle(tick)}
            >
              <Text variant="caption" tone="textSecondary">
                {formatAxisTime(tick.time)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Box>
  );
};

export default NetWorthLine;
