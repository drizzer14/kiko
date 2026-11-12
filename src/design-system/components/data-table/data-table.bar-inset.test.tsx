import { act } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import DataTable from '.';
import { resolveHeaderShift } from './data-table.layout';
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
