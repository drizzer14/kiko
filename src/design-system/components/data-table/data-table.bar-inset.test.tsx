import { act } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import DataTable from '.';
import {
  resolveHeaderShift,
  resolveStatusBandOpacity,
  STATUS_BAND_HEIGHT,
} from './data-table.layout';
import type { DataTableProps } from './data-table.props';

const SIDE_MARGIN = 16;

const mockClearance = { automatic: 37, plain: 99 };
const mockMargin = { value: SIDE_MARGIN };

jest.mock('@kiko/design-system/components/screen', () => ({
  ...jest.requireActual('@kiko/design-system/components/screen'),
  useAutomaticScrollClearance: () => mockClearance.automatic,
  useBottomClearance: () => mockClearance.plain,
  useContentMargin: () => mockMargin.value,
}));

const PREFIX = 'table';
const ROOT = PREFIX;

const makeCells = (texts: string[]) =>
  texts.map((text) => ({
    text,
    accessibilityLabel: `Groceries, ${text}`,
    accessibilityValue: `${text}.00 UAH`,
  }));

const baseProps: DataTableProps = {
  columns: [
    { key: 'jan', header: 'Jan' },
    { key: 'feb', header: 'Feb' },
  ],
  caption: 'Spending in UAH',
  rows: [{ key: 'groceries', label: 'Groceries', cells: makeCells(['120', '-45']) }],
  testID: PREFIX,
};

const layoutEvent = (width: number, y = 0) => ({
  nativeEvent: { layout: { x: 0, y, width, height: 40 } },
});

const flat = (element: { props: { style?: unknown } }) =>
  StyleSheet.flatten(element.props.style as never) as Record<string, unknown>;

const renderTable = async (props: Partial<DataTableProps> = {}) =>
  render(<DataTable {...baseProps} {...props} />);

describe('DataTable with a bar inset', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockMargin.value = SIDE_MARGIN;
  });

  describe('the root', () => {
    it('is the vertical scroll itself, so UIKit tracks it for the large title', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });

      expect(rendered.toJSON()).toMatchObject({ type: 'RCTScrollView', props: { testID: ROOT } });
    });

    it('is the vertical scroll without a bar inset too', async () => {
      const rendered = await renderTable();

      expect(rendered.toJSON()).toMatchObject({ type: 'RCTScrollView', props: { testID: ROOT } });
    });
  });

  describe('the scroll events', () => {
    it('reach the shift expression on the root, at one event a frame', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });

      expect(typeof rendered.getByTestId(ROOT).props.onScroll).toBe('function');
      expect(rendered.getByTestId(ROOT).props.scrollEventThrottle).toBe(16);
    });

    it('are not listened for without a bar inset', async () => {
      const rendered = await renderTable();

      expect(rendered.getByTestId(ROOT).props.onScroll).toBeUndefined();
      expect(rendered.getByTestId(ROOT).props.scrollEventThrottle).toBeUndefined();
    });
  });

  describe('the automatic inset', () => {
    it('is set on the vertical scroll', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });

      expect(rendered.getByTestId(ROOT).props.contentInsetAdjustmentBehavior).toBe('automatic');
    });

    it('is absent without a bar inset', async () => {
      const rendered = await renderTable();

      expect(rendered.getByTestId(ROOT).props.contentInsetAdjustmentBehavior).toBeUndefined();
    });
  });

  describe('the sticky header', () => {
    it('is not left to the scroll view, which would stick it behind the bar', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });

      expect(rendered.getByTestId(ROOT).props.stickyHeaderIndices).toBeUndefined();
    });

    it('moves by the helper value for the scroll offset and the bar height', async () => {
      const barInset = new Animated.Value(100);
      const eventSpy = jest.spyOn(Animated, 'event');
      const rendered = await renderTable({ barInset });
      const mapping = eventSpy.mock.calls[0][0] as unknown as {
        nativeEvent: { contentOffset: { y: Animated.Value } };
      }[];
      const scrollY = mapping[0].nativeEvent.contentOffset.y;
      const shiftedHeader = () =>
        rendered.getByTestId(`${PREFIX}-header-shift`, { includeHiddenElements: true });
      await fireEvent(shiftedHeader(), 'layout', layoutEvent(300, 300));
      // A native-driven value does not render again on a device, so the host style is read after
      // a render of the table that follows each change.
      const shiftOf = async () => {
        await rendered.rerender(<DataTable {...baseProps} barInset={barInset} />);

        const [{ translateY }] = flat(shiftedHeader()).transform as { translateY: number }[];

        return translateY;
      };

      for (const offset of [0, 150, 200, 260]) {
        await act(async () => scrollY.setValue(offset));

        expect(await shiftOf()).toBe(resolveHeaderShift(offset, 100, 300));
      }

      await act(async () => barInset.setValue(60));

      expect(await shiftOf()).toBe(resolveHeaderShift(260, 60, 300));
    });

    it('follows the bar down to the status bar when it minimizes and back when it returns', async () => {
      const barInset = new Animated.Value(82);
      const eventSpy = jest.spyOn(Animated, 'event');
      const rendered = await renderTable({ barInset });
      const mapping = eventSpy.mock.calls[0][0] as unknown as {
        nativeEvent: { contentOffset: { y: Animated.Value } };
      }[];
      const header = () =>
        rendered.getByTestId(`${PREFIX}-header-shift`, { includeHiddenElements: true });
      await fireEvent(header(), 'layout', layoutEvent(300, 408));
      await act(async () => mapping[0].nativeEvent.contentOffset.y.setValue(446));
      const shiftOf = async () => {
        await rendered.rerender(<DataTable {...baseProps} barInset={barInset} />);

        const [{ translateY }] = flat(header()).transform as { translateY: number }[];

        return translateY;
      };
      const shifts = [await shiftOf()];

      for (const inset of [24, 82]) {
        await act(async () => barInset.setValue(inset));
        shifts.push(await shiftOf());
      }

      expect(shifts).toEqual([120, 62, 120]);
    });

    it('draws the header above the body rows it slides over', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });
      const shifted = rendered.getByTestId(`${PREFIX}-header-shift`, {
        includeHiddenElements: true,
      });

      expect(flat(shifted).zIndex).toBe(1);
    });

    it('holds the column separators of the header inside the shifted header', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });
      const shifted = rendered.getByTestId(`${PREFIX}-header-shift`, {
        includeHiddenElements: true,
      });

      expect(
        within(shifted).getByTestId(`${PREFIX}-header-separator-jan`, {
          includeHiddenElements: true,
        }),
      ).toBeTruthy();
    });

    it('leaves the header under the scroll view sticky handling without a bar inset', async () => {
      const rendered = await renderTable();

      expect(rendered.getByTestId(ROOT).props.stickyHeaderIndices).toEqual([1]);
      expect(
        rendered.queryByTestId(`${PREFIX}-header-shift`, { includeHiddenElements: true }),
      ).toBeNull();
    });
  });

  describe('the status band', () => {
    type Rendered = Awaited<ReturnType<typeof render>>;

    const bandOf = (rendered: Rendered) =>
      rendered.getByTestId(`${PREFIX}-status-band`, { includeHiddenElements: true });

    const bandIn = (rendered: Rendered) =>
      rendered.queryByTestId(`${PREFIX}-status-band`, { includeHiddenElements: true });

    const tableUnder = (safeTop: number, props: Partial<DataTableProps>) => (
      <SafeAreaInsetsContext.Provider value={{ top: safeTop, right: 0, bottom: 0, left: 0 }}>
        <DataTable {...baseProps} {...props} />
      </SafeAreaInsetsContext.Provider>
    );

    const minimizedBar = (inset = 24) => ({
      barInset: new Animated.Value(inset),
      barMinimization: new Animated.Value(1),
    });

    it('is a hidden surface block above the header, inside the shifted header, full scroll width', async () => {
      const rendered = await render(tableUnder(0, minimizedBar()));
      const shifted = rendered.getByTestId(`${PREFIX}-header-shift`, {
        includeHiddenElements: true,
      });
      const band = within(shifted).getByTestId(`${PREFIX}-status-band`, {
        includeHiddenElements: true,
      });
      const headerRow = within(shifted).getByTestId(`${PREFIX}-header-row`, {
        includeHiddenElements: true,
      });

      expect(flat(band)).toMatchObject({
        position: 'absolute',
        top: -STATUS_BAND_HEIGHT,
        height: STATUS_BAND_HEIGHT,
        left: -SIDE_MARGIN,
        right: -SIDE_MARGIN,
        backgroundColor: flat(headerRow).backgroundColor,
      });
      expect(flat(band).backgroundColor).toBe(darkTheme.colors.surface);
      expect(band.props.pointerEvents).toBe('none');
      expect(band.props.accessibilityElementsHidden).toBe(true);
    });

    it('has a fixed height, whatever the safe-area top is', async () => {
      const rendered = await render(tableUnder(62, minimizedBar(62)));

      expect(flat(bandOf(rendered))).toMatchObject({
        top: -STATUS_BAND_HEIGHT,
        height: STATUS_BAND_HEIGHT,
      });
    });

    it('is not drawn without a bar inset', async () => {
      const rendered = await render(tableUnder(24, { barMinimization: new Animated.Value(1) }));

      expect(bandIn(rendered)).toBeNull();
    });

    it('is not drawn without a bar minimization', async () => {
      const rendered = await render(tableUnder(24, { barInset: new Animated.Value(24) }));

      expect(bandIn(rendered)).toBeNull();
    });

    it('is drawn at a safe-area top of zero', async () => {
      const rendered = await render(tableUnder(0, minimizedBar(82)));

      expect(bandIn(rendered)).not.toBeNull();
    });

    it('looks the same at a safe-area top of 24 and of zero', async () => {
      const atZero = await render(tableUnder(0, minimizedBar()));
      const atTwentyFour = await render(tableUnder(24, minimizedBar()));

      expect(flat(bandOf(atTwentyFour))).toEqual(flat(bandOf(atZero)));
    });

    it('keeps its height when the header row grows tall', async () => {
      const rendered = await render(tableUnder(0, minimizedBar()));
      await fireEvent(
        rendered.getByTestId(`${PREFIX}-header-shift`, { includeHiddenElements: true }),
        'layout',
        { nativeEvent: { layout: { x: 0, y: 300, width: 300, height: 400 } } },
      );

      expect(flat(bandOf(rendered)).height).toBe(STATUS_BAND_HEIGHT);
    });

    describe('opacity', () => {
      const SCROLLED_HEADER_Y = 300;
      const BAR_INSET = 100;

      const opacityOf = async (fraction: number, shift: number) => {
        const barInset = new Animated.Value(BAR_INSET);
        const barMinimization = new Animated.Value(fraction);
        const eventSpy = jest.spyOn(Animated, 'event');
        const rendered = await render(tableUnder(0, { barInset, barMinimization }));
        const mapping = eventSpy.mock.calls[0][0] as unknown as {
          nativeEvent: { contentOffset: { y: Animated.Value } };
        }[];
        await fireEvent(
          rendered.getByTestId(`${PREFIX}-header-shift`, { includeHiddenElements: true }),
          'layout',
          layoutEvent(300, SCROLLED_HEADER_Y),
        );
        await act(async () =>
          mapping[0].nativeEvent.contentOffset.y.setValue(shift + SCROLLED_HEADER_Y - BAR_INSET),
        );
        await rendered.rerender(tableUnder(0, { barInset, barMinimization }));

        return flat(bandOf(rendered)).opacity;
      };

      it.each([
        ['a Duo pane, bar minimized, header stuck', 1, 60, 1],
        ['an iPhone in portrait, bar minimized, header stuck', 1, 60, 1],
        ['at rest, bar minimized', 1, 0, 0],
        ['half-way onto the stick point, bar minimized', 1, 0.5, 0.5],
        ['stuck, bar half revealed', 0.5, 60, 0.5],
        ['half stuck, bar half revealed', 0.5, 0.5, 0.25],
        ['stuck before the bar has minimized', 0, 60, 0],
        ['stuck while an inline bar is revealed', 0, 60, 0],
        ['stretched past the top, bar minimized', 1, -5, 0],
        ['a shift of exactly one, bar fully minimized', 1, 1, 1],
        ['a fraction above one, stuck', 1.2, 60, 1],
        ['a fraction below zero, stuck', -0.1, 60, 0],
      ])('follows the rule and its table: %s', async (_name, fraction, shift, expected) => {
        const opacity = await opacityOf(fraction, shift);

        expect(opacity).toBeCloseTo(resolveStatusBandOpacity(shift, fraction), 10);
        expect(opacity).toBeCloseTo(expected, 10);
      });
    });
  });

  describe('the scroll content', () => {
    it('does not grow to the scroll height, which the inset would make scroll', async () => {
      const rendered = await renderTable({
        barInset: new Animated.Value(100),
        emptyContent: <View testID="nothing-here" />,
      });

      expect(
        StyleSheet.flatten(rendered.getByTestId(ROOT).props.contentContainerStyle).flexGrow,
      ).toBeUndefined();
    });

    it('pads its sides by the content margin', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });

      expect(
        StyleSheet.flatten(rendered.getByTestId(ROOT).props.contentContainerStyle)
          .paddingHorizontal,
      ).toBe(SIDE_MARGIN);
    });

    it('starts a gap below the bar, as Statistics does, so the large title and the first control do not touch', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });

      expect(
        StyleSheet.flatten(rendered.getByTestId(ROOT).props.contentContainerStyle).paddingTop,
      ).toBe(darkTheme.spacing(4));
    });

    it('clears the tab bar by the automatic-inset clearance and the end gap', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });

      expect(
        StyleSheet.flatten(rendered.getByTestId(ROOT).props.contentContainerStyle).paddingBottom,
      ).toBe(mockClearance.automatic + darkTheme.spacing(4));
    });
  });

  describe('the scroll content without a bar inset', () => {
    it('takes no top padding of its own', async () => {
      const rendered = await renderTable();

      expect(
        StyleSheet.flatten(rendered.getByTestId(ROOT).props.contentContainerStyle).paddingTop,
      ).toBeUndefined();
    });
  });

  describe('the width the columns share', () => {
    const fixedWidthOf = async (props: Partial<DataTableProps>, width: number) => {
      const rendered = await renderTable(props);
      await fireEvent(rendered.getByTestId(ROOT), 'layout', layoutEvent(width));
      await fireEvent(
        rendered.getByTestId(`${PREFIX}-measure-labels`, { includeHiddenElements: true }),
        'layout',
        layoutEvent(500),
      );

      return flat(rendered.getByTestId(`${PREFIX}-fixed-column`)).width;
    };

    it('leaves out the side padding the scroll content takes', async () => {
      expect(await fixedWidthOf({ barInset: new Animated.Value(100) }, 400)).toBe(
        (400 - SIDE_MARGIN * 2) * 0.4,
      );
    });

    it('follows a bar inset that appears at the same scroll width', async () => {
      const rendered = await renderTable();
      await fireEvent(rendered.getByTestId(ROOT), 'layout', layoutEvent(400));
      await fireEvent(
        rendered.getByTestId(`${PREFIX}-measure-labels`, { includeHiddenElements: true }),
        'layout',
        layoutEvent(500),
      );

      await rendered.rerender(<DataTable {...baseProps} barInset={new Animated.Value(100)} />);

      expect(flat(rendered.getByTestId(`${PREFIX}-fixed-column`)).width).toBe(
        (400 - SIDE_MARGIN * 2) * 0.4,
      );
    });

    it('refits the columns to a side margin that changes at the same scroll width', async () => {
      const barInset = new Animated.Value(100);
      const rendered = await renderTable({ barInset });
      await fireEvent(rendered.getByTestId(ROOT), 'layout', layoutEvent(400));
      await fireEvent(
        rendered.getByTestId(`${PREFIX}-measure-labels`, { includeHiddenElements: true }),
        'layout',
        layoutEvent(500),
      );

      mockMargin.value = 40;
      await rendered.rerender(<DataTable {...baseProps} barInset={barInset} />);

      expect(flat(rendered.getByTestId(`${PREFIX}-fixed-column`)).width).toBe((400 - 40 * 2) * 0.4);
    });

    it('is the whole width without a bar inset', async () => {
      expect(await fixedWidthOf({}, 400)).toBe(400 * 0.4);
    });
  });
});
