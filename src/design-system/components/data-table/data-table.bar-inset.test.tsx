import { act } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import DataTable from '.';
import { resolveHeaderShift } from './data-table.layout';
import type { DataTableProps } from './data-table.props';

const mockClearance = { automatic: 37, plain: 99 };

jest.mock('@kiko/design-system/components/screen', () => ({
  ...jest.requireActual('@kiko/design-system/components/screen'),
  useAutomaticScrollClearance: () => mockClearance.automatic,
  useBottomClearance: () => mockClearance.plain,
  useContentMargin: () => 16,
}));

const PREFIX = 'table';
const SIDE_MARGIN = 16;
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

    it('holds the measuring layer inside the scroll, so no wrapper view is needed', async () => {
      const rendered = await renderTable();

      expect(
        within(rendered.getByTestId(ROOT)).getByTestId(`${PREFIX}-measure-layer`, {
          includeHiddenElements: true,
        }),
      ).toBeTruthy();
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
      const originalAdd = Animated.add;
      let shiftExpression: { __getValue: () => number } | undefined;
      jest.spyOn(Animated, 'add').mockImplementation((first, second) => {
        const sum = originalAdd(first, second);
        const interpolate = sum.interpolate.bind(sum);

        sum.interpolate = ((config: Parameters<typeof interpolate>[0]) => {
          const expression = interpolate(config);
          shiftExpression = expression as unknown as { __getValue: () => number };

          return expression;
        }) as typeof sum.interpolate;

        return sum;
      });
      const rendered = await renderTable({ barInset });
      const mapping = eventSpy.mock.calls[0][0] as unknown as {
        nativeEvent: { contentOffset: { y: Animated.Value } };
      }[];
      const scrollY = mapping[0].nativeEvent.contentOffset.y;
      const shiftedHeader = () =>
        rendered.getByTestId(`${PREFIX}-header-shift`, { includeHiddenElements: true });
      await fireEvent(shiftedHeader(), 'layout', layoutEvent(300, 300));
      // A native-driven value does not render again, so the style a host holds is the number of the
      // last render; the expression itself is read.
      const shiftOf = () => shiftExpression?.__getValue();

      for (const offset of [0, 150, 200, 260]) {
        await act(async () => scrollY.setValue(offset));

        expect(shiftOf()).toBe(resolveHeaderShift(offset, 100, 300));
      }

      await act(async () => barInset.setValue(60));

      expect(shiftOf()).toBe(resolveHeaderShift(260, 60, 300));
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

    it('keeps growing to the scroll height without a bar inset', async () => {
      const rendered = await renderTable();

      expect(
        StyleSheet.flatten(rendered.getByTestId(ROOT).props.contentContainerStyle).flexGrow,
      ).toBe(1);
    });

    it('pads its sides by the content margin', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });

      expect(
        StyleSheet.flatten(rendered.getByTestId(ROOT).props.contentContainerStyle)
          .paddingHorizontal,
      ).toBe(SIDE_MARGIN);
    });

    it('clears the tab bar by the automatic-inset clearance and the end gap', async () => {
      const rendered = await renderTable({ barInset: new Animated.Value(100) });

      expect(
        StyleSheet.flatten(rendered.getByTestId(ROOT).props.contentContainerStyle).paddingBottom,
      ).toBe(mockClearance.automatic + darkTheme.spacing(4));
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

    it('is the whole width without a bar inset', async () => {
      expect(await fixedWidthOf({}, 400)).toBe(400 * 0.4);
    });
  });
});
