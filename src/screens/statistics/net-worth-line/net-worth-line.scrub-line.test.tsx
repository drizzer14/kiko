import { i18n } from '@kiko/i18n/init';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { State } from 'react-native-gesture-handler';
import { trigger } from 'react-native-haptic-feedback';
import { activeLocale } from '@kiko/i18n/active-locale';
import { formatDate, startOfLocalDay } from '@kiko/dates';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import type { NetWorthPoint } from '@kiko/statistics/net-worth-series';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { makeFocusNavigation } from '@kiko/test-support/focus-navigation';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';

import NetWorthLine from './index';
import { NET_WORTH_SCRUB_GESTURE_TEST_ID } from './net-worth-line.component';
import { SCRUB_ACTIVE_OFFSET_X, SCRUB_FAIL_OFFSET_Y } from './net-worth-line.scrub';

const PLOT_WIDTH = 240;
const LABEL_WIDTH = 80;
const VIEW_WIDTH = 320;

const buildPoints = (firstDayOffset: number, amounts: number[]): NetWorthPoint[] =>
  amounts.map((amount, index) => ({
    t: localDaysFrom(startOfLocalDay(Date.now()), firstDayOffset + index),
    amount,
  }));

const points = buildPoints(-3, [100, 300, 200, 400]);

const layoutEvent = (width: number) => ({
  nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } },
});

const renderLine = async (
  linePoints: NetWorthPoint[] = points,
  wrap: (node: ReactElement) => ReactElement = (node) => node,
) => {
  const element = (nextPoints: NetWorthPoint[]) =>
    wrap(<NetWorthLine points={nextPoints} startReference={50} baseCurrency="USD" />);
  const view = await render(element(linePoints), { wrapper: GestureRootWrapper });

  return {
    ...view,
    rerenderPoints: (nextPoints: NetWorthPoint[]) => view.rerender(element(nextPoints)),
  };
};

type RenderedLine = Awaited<ReturnType<typeof renderLine>>;

const measure = async ({ getByTestId }: RenderedLine): Promise<void> => {
  await fireEvent(getByTestId('net-worth-line-plot'), 'layout', layoutEvent(PLOT_WIDTH));
  await fireEvent(getByTestId('net-worth-line-scrub-label'), 'layout', layoutEvent(LABEL_WIDTH));
};

// The logical x of each plotted point, read back off the rendered polyline (the series stays above
// the reference, so it is one segment) instead of re-deriving the chart scale here.
const pointXs = ({ getByTestId }: RenderedLine): number[] =>
  String(getByTestId('net-worth-line-polyline-0').props.points)
    .split(' ')
    .map((pair) => Number(pair.split(',')[0]));

const touchXOf = (logicalX: number): number => (logicalX * PLOT_WIDTH) / VIEW_WIDTH;

const scrubX = ({ getByTestId }: RenderedLine): number =>
  Number(getByTestId('net-worth-line-scrub').props.x1);

const drag = async (touchXs: number[]): Promise<void> => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(NET_WORTH_SCRUB_GESTURE_TEST_ID), [
      { state: State.BEGAN, x: touchXs[0] },
      ...touchXs.map((x) => ({ state: State.ACTIVE, x })),
      { state: State.END, x: touchXs[touchXs.length - 1] },
    ]);
  });
};

const amountText = (amount: number): string =>
  formatMoney(Money.fromMajor('USD', amount), activeLocale());

const selectedDayText = (point: NetWorthPoint): string =>
  amountText(point.amount).concat(', ', formatDate(point.t));

const labelStyle = ({ getByTestId }: RenderedLine) =>
  StyleSheet.flatten(getByTestId('net-worth-line-scrub-label').props.style);

const labelWithin = ({ getByTestId }: RenderedLine) =>
  within(getByTestId('net-worth-line-scrub-label'));

describe('NetWorthLine scrub line', () => {
  beforeEach(() => {
    jest.mocked(trigger).mockClear();
  });

  it('draws the line in the reference baseline style, spanning the x-grid lines', async () => {
    const view = await renderLine();
    const scrub = view.getByTestId('net-worth-line-scrub').props;
    const reference = view.getByTestId('net-worth-line-reference').props;
    const grid = view.getByTestId('net-worth-line-x-grid-0.50').props;

    expect(scrub.strokeDasharray).toBe(reference.strokeDasharray);
    expect(scrub.stroke).toBe(reference.stroke);
    expect(scrub.strokeWidth).toBe(reference.strokeWidth);
    expect(scrub.x1).toBe(scrub.x2);
    expect(scrub.y1).toBe(grid.y1);
    expect(scrub.y2).toBe(grid.y2);
  });

  it('starts on the present day and labels that day', async () => {
    const view = await renderLine();
    const last = points[points.length - 1];

    expect(scrubX(view)).toBe(pointXs(view)[3]);
    expect(labelWithin(view).getByText(amountText(last.amount))).toBeTruthy();
    expect(labelWithin(view).getByText(formatDate(last.t))).toBeTruthy();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('pins the Pan config (Jest cannot see hit-testing, so the values are the proof)', async () => {
    await renderLine();
    const { config } = getByGestureTestId(NET_WORTH_SCRUB_GESTURE_TEST_ID);

    expect(SCRUB_ACTIVE_OFFSET_X).toBe(10);
    expect(SCRUB_FAIL_OFFSET_Y).toBe(10);
    expect(config.activeOffsetXStart).toBe(-10);
    expect(config.activeOffsetXEnd).toBe(10);
    expect(config.failOffsetYStart).toBe(-10);
    expect(config.failOffsetYEnd).toBe(10);
    expect(config.runOnJS).toBe(true);
    expect(config.testId).toBe('net-worth-line-scrub-gesture');
  });

  it('snaps to the nearest point under a drag and stays there after release', async () => {
    const view = await renderLine();
    await measure(view);

    await drag([touchXOf(pointXs(view)[1] + 5)]);

    expect(scrubX(view)).toBe(pointXs(view)[1]);
    expect(labelWithin(view).getByText(amountText(points[1].amount))).toBeTruthy();
    expect(labelWithin(view).getByText(formatDate(points[1].t))).toBeTruthy();
  });

  it('clamps a drag past either plot edge to the first and last point', async () => {
    const view = await renderLine();
    await measure(view);

    await drag([-50]);
    expect(scrubX(view)).toBe(pointXs(view)[0]);

    await drag([PLOT_WIDTH + 50]);
    expect(scrubX(view)).toBe(pointXs(view)[3]);
  });

  it('ignores a drag before the plot is measured', async () => {
    const view = await renderLine();

    await drag([touchXOf(pointXs(view)[1])]);

    expect(scrubX(view)).toBe(pointXs(view)[3]);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('ticks a selection haptic once per new point, never for a move within the same point', async () => {
    const view = await renderLine();
    await measure(view);
    const xs = pointXs(view).map(touchXOf);

    await drag([xs[1], xs[1] + 2, xs[1] - 2, xs[2]]);

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenNthCalledWith(1, 'selection');
    expect(trigger).toHaveBeenNthCalledWith(2, 'selection');
  });

  it('does not tick for a drag that stays on the present day, even past the right edge', async () => {
    const view = await renderLine();
    await measure(view);

    await drag([touchXOf(pointXs(view)[3]), PLOT_WIDTH + 30]);

    expect(trigger).not.toHaveBeenCalled();
  });

  it('flips the label left of the line at the right edge and right of it at the left edge', async () => {
    const view = await renderLine();
    await measure(view);

    expect(labelStyle(view).left).toBeLessThanOrEqual(touchXOf(pointXs(view)[3]) - LABEL_WIDTH);

    await drag([-50]);

    expect(labelStyle(view).left).toBeGreaterThan(touchXOf(pointXs(view)[0]));
    expect(Number(labelStyle(view).left) + LABEL_WIDTH).toBeLessThanOrEqual(PLOT_WIDTH);
  });

  it('hides the label until both the plot and the label are measured', async () => {
    const view = await renderLine();

    expect(labelStyle(view).opacity).toBe(0);

    await measure(view);

    expect(labelStyle(view).opacity).not.toBe(0);
  });

  it('goes back to the present day when the period changes', async () => {
    const view = await renderLine();
    await measure(view);
    await drag([touchXOf(pointXs(view)[1])]);

    await view.rerenderPoints(buildPoints(-5, [10, 20, 30, 40]));

    expect(scrubX(view)).toBe(pointXs(view)[3]);
    expect(labelWithin(view).getByText(amountText(40))).toBeTruthy();
  });

  it('keeps the line where it is on a live update with the same range key', async () => {
    const view = await renderLine();
    await measure(view);
    await drag([touchXOf(pointXs(view)[1])]);

    await view.rerenderPoints(buildPoints(-3, [100, 310, 210, 410]));

    expect(scrubX(view)).toBe(pointXs(view)[1]);
    expect(labelWithin(view).getByText(amountText(310))).toBeTruthy();
  });

  it('goes back to the present day when the screen regains focus', async () => {
    const navigation = makeFocusNavigation();
    const view = await renderLine(points, navigation.provide);
    await measure(view);
    await drag([touchXOf(pointXs(view)[1])]);
    expect(scrubX(view)).toBe(pointXs(view)[1]);

    await act(async () => {
      navigation.fireFocus();
    });

    expect(scrubX(view)).toBe(pointXs(view)[3]);
  });

  it('draws a one-point series with the line on that point', async () => {
    const view = await renderLine(buildPoints(0, [250]));
    await measure(view);

    expect(view.getByTestId('net-worth-line-scrub')).toBeTruthy();
    expect(labelWithin(view).getByText(amountText(250))).toBeTruthy();
  });

  it('draws no line in the empty or loading state, and draws it once points arrive', async () => {
    const view = await renderLine([]);
    expect(view.queryByTestId('net-worth-line-scrub')).toBeNull();

    const loading = await render(
      <NetWorthLine points={[]} startReference={0} baseCurrency="USD" loading />,
      { wrapper: GestureRootWrapper },
    );
    expect(loading.queryByTestId('net-worth-line-scrub')).toBeNull();

    await view.rerenderPoints(points);
    expect(view.getByTestId('net-worth-line-scrub')).toBeTruthy();
  });

  describe('accessibility', () => {
    const fireAction = async (view: RenderedLine, actionName: 'increment' | 'decrement') =>
      fireEvent(view.getByTestId('net-worth-line-plot'), 'accessibilityAction', {
        nativeEvent: { actionName },
      });

    it('exposes the plot as one adjustable element reading the selected day', async () => {
      const view = await renderLine();
      const plot = view.getByTestId('net-worth-line-plot').props;

      expect(plot.accessible).toBe(true);
      expect(plot.accessibilityRole).toBe('adjustable');
      expect(plot.accessibilityLabel).toBe('Net worth by day');
      expect(plot.accessibilityValue).toEqual({ text: selectedDayText(points[3]) });
      expect(plot.accessibilityActions).toEqual([{ name: 'increment' }, { name: 'decrement' }]);
    });

    it('steps the line one point per action without a haptic, clamped at both ends', async () => {
      const view = await renderLine();

      await fireAction(view, 'decrement');
      expect(scrubX(view)).toBe(pointXs(view)[2]);
      expect(view.getByTestId('net-worth-line-plot').props.accessibilityValue).toEqual({
        text: selectedDayText(points[2]),
      });

      await fireAction(view, 'increment');
      await fireAction(view, 'increment');
      expect(scrubX(view)).toBe(pointXs(view)[3]);

      for (let step = 0; step < 5; step += 1) {
        await fireAction(view, 'decrement');
      }
      expect(scrubX(view)).toBe(pointXs(view)[0]);
      expect(trigger).not.toHaveBeenCalled();
    });

    describe('in Ukrainian', () => {
      beforeEach(async () => {
        await act(async () => {
          await i18n.changeLanguage('uk');
        });
      });

      afterEach(async () => {
        await act(async () => {
          await i18n.changeLanguage('en');
        });
      });

      it('reads the chart label in Ukrainian', async () => {
        const view = await renderLine();

        expect(view.getByTestId('net-worth-line-plot').props.accessibilityLabel).toBe(
          'Капітал за днями',
        );
      });
    });
  });
});
