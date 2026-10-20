import { i18n } from '@kiko/i18n/init';
import { StyleSheet } from 'react-native';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { State } from 'react-native-gesture-handler';
import { darkTheme } from '@kiko/design-system/theme';
import { trigger } from 'react-native-haptic-feedback';
import { activeLocale } from '@kiko/i18n/active-locale';
import { formatDate, startOfLocalDay } from '@kiko/dates';
import type { ComponentProps, ReactElement } from 'react';
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

// Distinct line heights, as under Dynamic Type where the amount and the date scale apart. The
// amount stays within the room above the plot, so the label is not clamped.
const AMOUNT_HEIGHT = 20;
const DATE_HEIGHT = 16;
// The room the host leaves above the plot, in spacing units: the Statistics card's title gap.
const SPACE_ABOVE = 3;
const ACCESSIBILITY_AMOUNT_HEIGHT = 60;

const layoutEvent = (width: number, height = 40) => ({
  nativeEvent: { layout: { x: 0, y: 0, width, height } },
});

const renderLine = async (
  linePoints: NetWorthPoint[] = points,
  wrap: (node: ReactElement) => ReactElement = (node) => node,
  roomProps: Pick<ComponentProps<typeof NetWorthLine>, 'spaceAbove'> = { spaceAbove: SPACE_ABOVE },
) => {
  const element = (nextPoints: NetWorthPoint[]) =>
    wrap(
      <NetWorthLine points={nextPoints} startReference={50} baseCurrency="USD" {...roomProps} />,
    );
  const view = await render(element(linePoints), { wrapper: GestureRootWrapper });

  return {
    ...view,
    rerenderPoints: (nextPoints: NetWorthPoint[]) => view.rerender(element(nextPoints)),
  };
};

type RenderedLine = Awaited<ReturnType<typeof renderLine>>;

const measure = async ({ getByTestId }: RenderedLine): Promise<void> => {
  await fireEvent(getByTestId('net-worth-line-plot'), 'layout', layoutEvent(PLOT_WIDTH));
  await fireEvent(
    getByTestId('net-worth-line-scrub-label'),
    'layout',
    layoutEvent(LABEL_WIDTH, AMOUNT_HEIGHT + DATE_HEIGHT),
  );
  await fireEvent(
    getByTestId('net-worth-line-scrub-amount'),
    'layout',
    layoutEvent(LABEL_WIDTH, AMOUNT_HEIGHT),
  );
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

  it('shows the label at its exact place beside the line (the gap is 8)', async () => {
    const view = await renderLine();
    await measure(view);

    expect(pointXs(view)[3]).toBe(312);
    expect(labelStyle(view).left).toBe(146);

    await drag([-50]);

    expect(pointXs(view)[0]).toBe(8);
    expect(labelStyle(view).left).toBe(14);
  });

  it('draws the label with no background', async () => {
    const view = await renderLine();
    await measure(view);

    expect(labelStyle(view).backgroundColor).toBeUndefined();
  });

  describe('vertical placement', () => {
    // The gap between the amount line and the date line, in the plot's coordinates: the label's
    // top plus the measured amount height.
    const gapY = (view: RenderedLine, amountHeight: number): number =>
      Number(labelStyle(view).top) + amountHeight;

    const tipY = ({ getByTestId }: RenderedLine): number =>
      Number(getByTestId('net-worth-line-scrub').props.y1);

    it('puts the gap between the amount and the date on the tip of the line, at rest', async () => {
      const view = await renderLine();
      await measure(view);

      expect(gapY(view, AMOUNT_HEIGHT)).toBe(tipY(view));
    });

    it('keeps the gap on the tip of the line after a drag to either edge', async () => {
      const view = await renderLine();
      await measure(view);

      await drag([-50]);
      expect(gapY(view, AMOUNT_HEIGHT)).toBe(tipY(view));

      await drag([PLOT_WIDTH + 50]);
      expect(gapY(view, AMOUNT_HEIGHT)).toBe(tipY(view));
    });

    it('follows the measured amount height, not a constant', async () => {
      const view = await renderLine();
      await measure(view);

      await fireEvent(
        view.getByTestId('net-worth-line-scrub-amount'),
        'layout',
        layoutEvent(LABEL_WIDTH, AMOUNT_HEIGHT + 2),
      );

      expect(gapY(view, AMOUNT_HEIGHT + 2)).toBe(tipY(view));
    });

    it('keeps the default-size amount over the plot top, as before the clamp', async () => {
      const view = await renderLine();
      await measure(view);

      await fireEvent(
        view.getByTestId('net-worth-line-scrub-amount'),
        'layout',
        layoutEvent(LABEL_WIDTH, DATE_HEIGHT),
      );

      expect(labelStyle(view).top).toBe(tipY(view) - DATE_HEIGHT);
      expect(labelStyle(view).top).toBe(-4);
    });

    it('stops the label at the room above the plot at an accessibility text size', async () => {
      const view = await renderLine();
      await measure(view);

      await fireEvent(
        view.getByTestId('net-worth-line-scrub-amount'),
        'layout',
        layoutEvent(LABEL_WIDTH, ACCESSIBILITY_AMOUNT_HEIGHT),
      );

      expect(labelStyle(view).top).toBe(-darkTheme.spacing(SPACE_ABOVE));
    });

    it('keeps the label inside the plot when the host leaves no room above it', async () => {
      const view = await renderLine(points, undefined, {});
      await measure(view);

      expect(Number(labelStyle(view).top)).toBeGreaterThanOrEqual(0);
    });

    it('does not move when only the date line gets taller', async () => {
      const view = await renderLine();
      await measure(view);
      const { top } = labelStyle(view);

      await fireEvent(
        view.getByTestId('net-worth-line-scrub-label'),
        'layout',
        layoutEvent(LABEL_WIDTH, AMOUNT_HEIGHT + DATE_HEIGHT * 2),
      );

      expect(labelStyle(view).top).toBe(top);
      expect(gapY(view, AMOUNT_HEIGHT)).toBe(tipY(view));
    });
  });

  it('keeps the label hidden until the amount line is measured too', async () => {
    const view = await renderLine();

    await fireEvent(view.getByTestId('net-worth-line-plot'), 'layout', layoutEvent(PLOT_WIDTH));
    await fireEvent(
      view.getByTestId('net-worth-line-scrub-label'),
      'layout',
      layoutEvent(LABEL_WIDTH, AMOUNT_HEIGHT + DATE_HEIGHT),
    );

    expect(labelStyle(view).opacity).toBe(0);
  });

  it('keeps the label hidden after only the plot is measured', async () => {
    const view = await renderLine();

    await fireEvent(view.getByTestId('net-worth-line-plot'), 'layout', layoutEvent(PLOT_WIDTH));

    expect(labelStyle(view).opacity).toBe(0);
  });

  it('keeps the label hidden after only the label is measured', async () => {
    const view = await renderLine();

    await fireEvent(
      view.getByTestId('net-worth-line-scrub-label'),
      'layout',
      layoutEvent(LABEL_WIDTH),
    );

    expect(labelStyle(view).opacity).toBe(0);
  });

  it('keeps the label hidden until its own width arrives, then shows it', async () => {
    const view = await renderLine();

    await fireEvent(view.getByTestId('net-worth-line-plot'), 'layout', layoutEvent(PLOT_WIDTH));
    await fireEvent(
      view.getByTestId('net-worth-line-scrub-amount'),
      'layout',
      layoutEvent(LABEL_WIDTH, AMOUNT_HEIGHT),
    );

    expect(labelStyle(view).opacity).toBe(0);

    await fireEvent(
      view.getByTestId('net-worth-line-scrub-label'),
      'layout',
      layoutEvent(LABEL_WIDTH, AMOUNT_HEIGHT + DATE_HEIGHT),
    );

    expect(labelStyle(view).opacity).toBe(1);
  });

  it('keeps the label hidden until the plot is laid out, then shows it', async () => {
    const view = await renderLine();

    await fireEvent(
      view.getByTestId('net-worth-line-scrub-label'),
      'layout',
      layoutEvent(LABEL_WIDTH, AMOUNT_HEIGHT + DATE_HEIGHT),
    );
    await fireEvent(
      view.getByTestId('net-worth-line-scrub-amount'),
      'layout',
      layoutEvent(LABEL_WIDTH, AMOUNT_HEIGHT),
    );

    expect(labelStyle(view).opacity).toBe(0);

    await fireEvent(view.getByTestId('net-worth-line-plot'), 'layout', layoutEvent(PLOT_WIDTH));

    expect(labelStyle(view).opacity).toBe(1);
  });

  it('shows the label fully once both are measured', async () => {
    const view = await renderLine();
    await measure(view);

    expect(labelStyle(view).opacity).toBe(1);
  });

  it('ticks again when a new drag returns to a point after the line moved elsewhere', async () => {
    const view = await renderLine();
    await measure(view);
    const xs = pointXs(view).map(touchXOf);

    await drag([xs[1]]);
    await fireEvent(view.getByTestId('net-worth-line-plot'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(scrubX(view)).toBe(pointXs(view)[2]);

    await drag([xs[1]]);

    expect(scrubX(view)).toBe(pointXs(view)[1]);
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it('goes back to the present day when the period changes', async () => {
    const view = await renderLine();
    await measure(view);
    await drag([touchXOf(pointXs(view)[1])]);

    await view.rerenderPoints(buildPoints(-5, [10, 20, 30, 40]));

    expect(scrubX(view)).toBe(pointXs(view)[3]);
    expect(labelWithin(view).getByText(amountText(40))).toBeTruthy();
  });

  it('stays on the present day when the earlier range is picked again', async () => {
    const view = await renderLine();
    await measure(view);
    await drag([touchXOf(pointXs(view)[1])]);

    await view.rerenderPoints(buildPoints(-5, [10, 20, 30, 40]));
    await view.rerenderPoints(points);

    expect(scrubX(view)).toBe(pointXs(view)[3]);
    expect(labelWithin(view).getByText(amountText(points[3].amount))).toBeTruthy();
    expect(labelWithin(view).getByText(formatDate(points[3].t))).toBeTruthy();
  });

  it('stays on the present day when the earlier range returns after an empty series', async () => {
    const view = await renderLine();
    await measure(view);
    await drag([touchXOf(pointXs(view)[1])]);

    await view.rerenderPoints([]);
    await view.rerenderPoints([]);
    await view.rerenderPoints(points);

    expect(scrubX(view)).toBe(pointXs(view)[3]);
    expect(labelWithin(view).getByText(amountText(points[3].amount))).toBeTruthy();
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

    it('ignores an accessibility action that is not a step', async () => {
      const view = await renderLine();

      await fireEvent(view.getByTestId('net-worth-line-plot'), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      });

      expect(scrubX(view)).toBe(pointXs(view)[3]);
      expect(view.getByTestId('net-worth-line-plot').props.accessibilityValue).toEqual({
        text: selectedDayText(points[3]),
      });
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
