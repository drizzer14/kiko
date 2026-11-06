import { useEffect } from 'react';
import * as reanimated from 'react-native-reanimated';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import DataTable from '.';
import type { DataTableProps } from './data-table.props';

const PREFIX = 'table';
const HORIZONTAL_PADDING = darkTheme.spacing(4);
const VERTICAL_PADDING = darkTheme.spacing(4);
const MIN_ROW_HEIGHT = 44;

type Cell = DataTableProps['rows'][number]['cells'][number];

const columns: DataTableProps['columns'] = [
  { key: 'jan', header: 'Jan' },
  { key: 'feb', header: 'Feb' },
  { key: 'total', header: 'Total', isSum: true },
];

const makeCells = (texts: string[], overrides: Partial<Cell> = {}): Cell[] =>
  texts.map((text) => ({
    text,
    accessibilityLabel: `Groceries, ${text}`,
    accessibilityValue: `${text}.00 UAH`,
    ...overrides,
  }));

const baseProps: DataTableProps = {
  columns,
  caption: 'Spending in UAH',
  rows: [
    { key: 'groceries', label: 'Groceries', cells: makeCells(['120', '-45', '75']) },
    { key: 'all', label: 'All', isSummary: true, cells: makeCells(['300', '-90', '210']) },
  ],
  testID: PREFIX,
};

const layoutEvent = (width: number, height = 0) => ({
  nativeEvent: { layout: { x: 0, y: 0, width, height } },
});

const flat = (element: { props: { style?: unknown } }) =>
  StyleSheet.flatten(element.props.style as never) as Record<string, unknown>;

type Rendered = Awaited<ReturnType<typeof render>>;

const setContainerWidth = async (rendered: Rendered, width: number) => {
  await fireEvent(rendered.getByTestId(PREFIX), 'layout', layoutEvent(width, 600));
};

const measureColumn = async (rendered: Rendered, key: string, width: number) => {
  await fireEvent(
    rendered.getByTestId(`${PREFIX}-measure-column-${key}`, { includeHiddenElements: true }),
    'layout',
    layoutEvent(width),
  );
};

const measureLabels = async (rendered: Rendered, width: number) => {
  await fireEvent(
    rendered.getByTestId(`${PREFIX}-measure-labels`, { includeHiddenElements: true }),
    'layout',
    layoutEvent(width),
  );
};

const measureAllColumns = async (rendered: Rendered, width: number) => {
  for (const column of columns) {
    await measureColumn(rendered, column.key, width);
  }
};

const measureText = async (rendered: Rendered, testID: string, height: number) => {
  await fireEvent(rendered.getByTestId(`${PREFIX}-${testID}`), 'layout', layoutEvent(40, height));
};

const renderTable = async (props: Partial<DataTableProps> = {}) =>
  render(<DataTable {...baseProps} {...props} />);

describe('DataTable', () => {
  describe('horizontal scroll', () => {
    it('turns the horizontal scroll off when every column fits', async () => {
      const rendered = await renderTable();
      await setContainerWidth(rendered, 1000);
      await measureLabels(rendered, 60);
      await measureAllColumns(rendered, 50);

      expect(rendered.getByTestId(`${PREFIX}-body-scroll`).props.scrollEnabled).toBe(false);
    });

    it('turns the horizontal scroll on when the columns overflow', async () => {
      const rendered = await renderTable();
      await setContainerWidth(rendered, 300);
      await measureLabels(rendered, 60);
      await measureAllColumns(rendered, 100);

      expect(rendered.getByTestId(`${PREFIX}-body-scroll`).props.scrollEnabled).toBe(true);
    });

    it('keeps the fixed column outside the horizontal scroll', async () => {
      const rendered = await renderTable();
      await setContainerWidth(rendered, 300);
      await measureLabels(rendered, 60);
      await measureAllColumns(rendered, 100);
      const scrolled = rendered.getByTestId(`${PREFIX}-body-scroll`);

      expect(scrolled.props.horizontal).toBe(true);
      expect(rendered.getByTestId(`${PREFIX}-label-groceries`)).toBeTruthy();
      expect(within(scrolled).queryByTestId(`${PREFIX}-label-groceries`)).toBeNull();
      expect(within(scrolled).getByTestId(`${PREFIX}-cell-groceries-jan`)).toBeTruthy();
    });
  });

  describe('fixed column width', () => {
    it('caps the first column at 40% of the measured width', async () => {
      const rendered = await renderTable();
      await setContainerWidth(rendered, 400);
      await measureLabels(rendered, 300);
      await measureAllColumns(rendered, 100);

      expect(flat(rendered.getByTestId(`${PREFIX}-fixed-column`)).width).toBe(160);
    });

    it('sizes the first column to its label plus padding when that is under the cap', async () => {
      const rendered = await renderTable();
      await setContainerWidth(rendered, 400);
      await measureLabels(rendered, 60);
      await measureAllColumns(rendered, 100);

      expect(flat(rendered.getByTestId(`${PREFIX}-fixed-column`)).width).toBe(
        60 + HORIZONTAL_PADDING + darkTheme.layout.hairline,
      );
    });

    it('wraps a long Ukrainian label in full, with no line limit', async () => {
      const label = 'Комунальні послуги та інші регулярні платежі за квартиру';
      const rendered = await renderTable({
        rows: [{ key: 'long', label, cells: makeCells(['1', '2', '3']) }],
      });
      await setContainerWidth(rendered, 400);
      await measureLabels(rendered, 500);
      await measureAllColumns(rendered, 100);
      const text = rendered.getByText(label);

      expect(text.props.children).toBe(label);
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.ellipsizeMode).toBeUndefined();
      expect(flat(rendered.getByTestId(`${PREFIX}-fixed-column`)).width).toBe(160);
    });
  });

  describe('amount text', () => {
    it('never limits lines or shrinks an amount', async () => {
      const rendered = await renderTable();
      const amount = rendered.getByText('120');

      expect(amount.props.numberOfLines).toBeUndefined();
      expect(amount.props.adjustsFontSizeToFit).toBeUndefined();
      expect(amount.props.minimumFontScale).toBeUndefined();
    });

    it('sets tabular-nums on cell text', async () => {
      const rendered = await renderTable();

      expect(flat(rendered.getByText('120')).fontVariant).toEqual(['tabular-nums']);
    });

    it('paints a negative cell with the negative token and a plain one without it', async () => {
      const rendered = await renderTable({
        rows: [
          {
            key: 'row',
            label: 'Row',
            cells: [
              { ...makeCells(['-45'])[0], tone: 'negative' },
              ...makeCells(['45']),
              ...makeCells(['0']),
            ],
          },
        ],
      });

      expect(flat(rendered.getByText('-45')).color).toBe(darkTheme.colors.negative);
      expect(flat(rendered.getByText('45')).color).not.toBe(darkTheme.colors.negative);
    });
  });

  describe('row height', () => {
    it('uses the taller measured part as minHeight on both parts, never a fixed height', async () => {
      const rendered = await renderTable();
      await measureText(rendered, 'label-groceries', 70);
      await measureText(rendered, 'cell-text-groceries-jan', 20);
      const fixedRow = flat(rendered.getByTestId(`${PREFIX}-fixed-row-groceries`));
      const scrolledRow = flat(rendered.getByTestId(`${PREFIX}-scrolled-row-groceries`));

      expect(fixedRow.minHeight).toBe(70 + VERTICAL_PADDING);
      expect(scrolledRow.minHeight).toBe(70 + VERTICAL_PADDING);
      expect(fixedRow.height).toBeUndefined();
      expect(scrolledRow.height).toBeUndefined();
    });

    it('lets the scrolled part set the height when it is the taller one', async () => {
      const rendered = await renderTable();
      await measureText(rendered, 'label-groceries', 20);
      await measureText(rendered, 'cell-text-groceries-feb', 90);

      expect(flat(rendered.getByTestId(`${PREFIX}-fixed-row-groceries`)).minHeight).toBe(
        90 + VERTICAL_PADDING,
      );
    });

    it('keeps a row at least as tall as the 44pt touch target', async () => {
      const rendered = await renderTable();
      await measureText(rendered, 'label-groceries', 10);

      expect(flat(rendered.getByTestId(`${PREFIX}-scrolled-row-groceries`)).minHeight).toBe(
        MIN_ROW_HEIGHT,
      );
    });

    it('shrinks the row again when the measured text gets shorter', async () => {
      const rendered = await renderTable();
      await measureText(rendered, 'label-groceries', 90);
      await measureText(rendered, 'label-groceries', 10);

      expect(flat(rendered.getByTestId(`${PREFIX}-fixed-row-groceries`)).minHeight).toBe(
        MIN_ROW_HEIGHT,
      );
    });
  });

  describe('column widths', () => {
    it('sizes each column from its measured text plus padding', async () => {
      const rendered = await renderTable();
      await setContainerWidth(rendered, 1000);
      await measureColumn(rendered, 'jan', 80);
      await measureColumn(rendered, 'feb', 40);
      await measureColumn(rendered, 'total', 120);

      expect(
        flat(rendered.getByTestId(`${PREFIX}-header-jan`, { includeHiddenElements: true })).width,
      ).toBe(80 + HORIZONTAL_PADDING);
      expect(flat(rendered.getByTestId(`${PREFIX}-cell-groceries-feb`)).width).toBe(
        40 + HORIZONTAL_PADDING,
      );
      expect(flat(rendered.getByTestId(`${PREFIX}-cell-all-total`)).width).toBe(
        120 + HORIZONTAL_PADDING,
      );
    });

    it('measures the summary row in its own bold weight, so a bold amount is never cut', async () => {
      const rendered = await renderTable();
      const bold = rendered.getByTestId(`${PREFIX}-measure-text-jan-all`, {
        includeHiddenElements: true,
      });
      const plain = rendered.getByTestId(`${PREFIX}-measure-text-jan-groceries`, {
        includeHiddenElements: true,
      });

      expect(flat(bold).fontWeight).toBe('700');
      expect(flat(plain).fontWeight).not.toBe('700');
    });
  });

  describe('initial column', () => {
    const scrollTo = () => ScrollView.prototype.scrollTo as jest.Mock;
    const settle = async (initialColumnIndex?: number) => {
      const rendered = await renderTable({ initialColumnIndex });
      await setContainerWidth(rendered, 300);
      await measureLabels(rendered, 60);
      await measureColumn(rendered, 'jan', 80);
      await measureColumn(rendered, 'feb', 100);
      await measureColumn(rendered, 'total', 140);

      return rendered;
    };

    const HAIRLINE = darkTheme.layout.hairline;
    const offsetBox = { value: 0 };
    const rerenderTable = async (rendered: Rendered, props: Partial<DataTableProps>) => {
      await rendered.rerender(<DataTable {...baseProps} {...props} />);
    };

    beforeEach(() => {
      offsetBox.value = 0;
      jest.spyOn(reanimated, 'useScrollOffset').mockReturnValue(offsetBox as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('scrolls so the chosen column sits at the fixed column, from measured widths', async () => {
      const rendered = await settle(1);
      await rerenderTable(rendered, { initialColumnIndex: 1 });

      expect(scrollTo()).toHaveBeenCalledTimes(1);
      expect(scrollTo()).toHaveBeenCalledWith({
        x: 80 + HORIZONTAL_PADDING,
        y: 0,
        animated: false,
      });
    });

    it('does not scroll further than the content allows', async () => {
      await settle(2);

      // Widths 96 + 116 + 156 = 368 in 300 - (76 + hairline) of room, so the furthest offset is
      // 144 + hairline.
      expect(scrollTo()).toHaveBeenCalledWith({ x: 144 + HAIRLINE, y: 0, animated: false });
    });

    it('stays at the start when no initial column is given', async () => {
      await settle(undefined);

      expect(scrollTo()).not.toHaveBeenCalled();
    });

    it('does not scroll on first mount when the column resolves to offset 0', async () => {
      await settle(0);

      expect(scrollTo()).not.toHaveBeenCalled();
    });

    it('scrolls to 0 when the initial column changes to one that resolves to offset 0', async () => {
      const rendered = await settle(1);
      await rerenderTable(rendered, { initialColumnIndex: 0 });

      expect(scrollTo()).toHaveBeenLastCalledWith({ x: 0, y: 0, animated: false });
    });

    it('never moves the scroll on a re-render with the same index and new data', async () => {
      const rendered = await settle(1);
      offsetBox.value = 90;
      scrollTo().mockClear();
      await rerenderTable(rendered, {
        initialColumnIndex: 1,
        rows: [{ key: 'rent', label: 'Rent', cells: makeCells(['9', '8', '7']) }],
      });

      expect(scrollTo()).not.toHaveBeenCalled();
    });

    it('scrolls to the furthest valid offset, unanimated, when the columns shrink', async () => {
      const rendered = await settle(undefined);
      offsetBox.value = 200;
      await measureColumn(rendered, 'jan', 80);
      await measureColumn(rendered, 'feb', 80);
      await measureColumn(rendered, 'total', 80);

      // Widths 3 x 96 = 288 in 300 - (76 + hairline) of room: the furthest offset is 64 + hairline.
      expect(scrollTo()).toHaveBeenLastCalledWith({ x: 64 + HAIRLINE, y: 0, animated: false });
    });

    it('scrolls to 0 when the columns shrink until they all fit, with scrolling off', async () => {
      const rendered = await settle(undefined);
      offsetBox.value = 100;
      await measureColumn(rendered, 'jan', 30);
      await measureColumn(rendered, 'feb', 30);
      await measureColumn(rendered, 'total', 30);

      expect(rendered.getByTestId(`${PREFIX}-body-scroll`).props.scrollEnabled).toBe(false);
      expect(scrollTo()).toHaveBeenLastCalledWith({ x: 0, y: 0, animated: false });
    });

    describe('across the empty content', () => {
      type BodyHost = { props: { testID?: string } };
      type BodyPrototype = { componentDidMount?: (this: BodyHost) => void };

      const bodyId = `${PREFIX}-body-scroll`;
      const emptyContent = <View testID="nothing-here" />;
      const firstColumnOffset = 80 + HORIZONTAL_PADDING;
      // Where the body really is, as the native side keeps it: a body mounts at 0 and says nothing,
      // a scrollTo moves it and reports the new offset to the shared value the header follows.
      const nativeBody = { offset: 0 };
      const scrollByUser = (x: number) => {
        nativeBody.offset = x;
        offsetBox.value = x;
      };
      // The production empty table keeps its summary row, with zeros.
      const zeroRow = (columnCount: number): DataTableProps['rows'] => [
        {
          key: 'all',
          label: 'All',
          isSummary: true,
          cells: makeCells(Array.from({ length: columnCount }, () => '0')),
        },
      ];
      const emptied: Partial<DataTableProps> = { rows: zeroRow(columns.length), emptyContent };
      const months: DataTableProps['columns'] = Array.from({ length: 12 }, (_, index) => ({
        key: `month-${index}`,
        header: `M${index + 1}`,
      }));
      const monthRows = (text: string): DataTableProps['rows'] => [
        { key: 'groceries', label: 'Groceries', cells: makeCells(months.map(() => text)) },
        { key: 'all', label: 'All', isSummary: true, cells: makeCells(months.map(() => text)) },
      ];
      const realThree = { labels: 60, jan: 80, feb: 100, total: 140 };
      const narrowThree = { labels: 20, jan: 8, feb: 8, total: 8 };
      const widthsOfMonths = (labels: number, month: number) => ({
        labels,
        ...Object.fromEntries(months.map(({ key }) => [key, month])),
      });
      const realMonths = widthsOfMonths(60, 100);
      const refilledMonths = widthsOfMonths(60, 110);
      const narrowMonths = widthsOfMonths(20, 8);
      // What the device reports: a layout event for each measuring view that is mounted, none for
      // one that is not.
      const reportWidths = async (rendered: Rendered, widths: Record<string, number>) => {
        const mounted = rendered.queryAllByTestId(/^table-measure-(labels|column-.+)$/, {
          includeHiddenElements: true,
        });

        for (const view of mounted) {
          const key = String(view.props.testID).replace(`${PREFIX}-measure-`, '');

          await fireEvent(view, 'layout', layoutEvent(widths[key.replace('column-', '')]));
        }
      };
      // Empty, the measuring views report the widths of the zero row (if any is mounted); filled
      // again, they report the widths of the real rows.
      const crossEmptyState = async (
        rendered: Rendered,
        crossing: {
          emptied: Partial<DataTableProps>;
          filled: Partial<DataTableProps>;
          narrow: Record<string, number>;
          real: Record<string, number>;
        },
      ) => {
        await rerenderTable(rendered, crossing.emptied);
        await reportWidths(rendered, crossing.narrow);
        await rerenderTable(rendered, crossing.filled);
        await reportWidths(rendered, crossing.real);
      };
      const crossThreeColumns = (rendered: Rendered) =>
        crossEmptyState(rendered, {
          emptied: { ...emptied, initialColumnIndex: 1 },
          filled: { initialColumnIndex: 1 },
          narrow: narrowThree,
          real: realThree,
        });

      beforeEach(() => {
        nativeBody.offset = 0;
        (ScrollView.prototype as unknown as BodyPrototype).componentDidMount = function (
          this: BodyHost,
        ) {
          if (this.props.testID === bodyId) {
            nativeBody.offset = 0;
          }
        };
        scrollTo().mockImplementation(function (this: BodyHost, { x }: { x: number }) {
          if (this.props.testID === bodyId) {
            nativeBody.offset = x;
            offsetBox.value = x;
          }
        });
      });

      afterEach(() => {
        (ScrollView.prototype as unknown as BodyPrototype).componentDidMount = undefined;
        scrollTo().mockReset();
      });

      it('opens at the initial column from the real widths, not the widths of the zero row', async () => {
        const rendered = await renderTable({
          columns: months,
          rows: monthRows('1,000'),
          initialColumnIndex: 9,
        });
        await setContainerWidth(rendered, 390);
        await reportWidths(rendered, realMonths);

        // Nine columns of 100 + 16 lead the ninth index, and 1392 - (390 - 76 - hairline) of
        // content is room enough to reach it.
        expect(nativeBody.offset).toBe(9 * (100 + HORIZONTAL_PADDING));

        scrollByUser(300);
        // The refill is wider than the table was before the empty state, so only its own widths
        // put the column where it belongs.
        await crossEmptyState(rendered, {
          emptied: {
            columns: months,
            rows: zeroRow(months.length),
            emptyContent,
            initialColumnIndex: 9,
          },
          filled: { columns: months, rows: monthRows('1,000'), initialColumnIndex: 9 },
          narrow: narrowMonths,
          real: refilledMonths,
        });

        expect(nativeBody.offset).toBe(9 * (110 + HORIZONTAL_PADDING));
        expect(offsetBox.value).toBe(nativeBody.offset);
      });

      it('keeps the header on a new body opened at the initial column, with no scroll before', async () => {
        const rendered = await settle(1);
        await crossThreeColumns(rendered);

        expect(nativeBody.offset).toBe(firstColumnOffset);
        expect(offsetBox.value).toBe(nativeBody.offset);
      });

      it('opens at the initial column when the table first mounted empty', async () => {
        const rendered = await renderTable({ initialColumnIndex: 1, ...emptied });
        await setContainerWidth(rendered, 300);
        await reportWidths(rendered, narrowThree);
        await rerenderTable(rendered, { initialColumnIndex: 1 });
        await reportWidths(rendered, realThree);

        expect(nativeBody.offset).toBe(firstColumnOffset);
        expect(offsetBox.value).toBe(nativeBody.offset);
      });

      it('leaves a scroll of the user alone when a later measure follows the refill', async () => {
        const rendered = await settle(1);
        await crossThreeColumns(rendered);
        scrollByUser(120);
        scrollTo().mockClear();
        await measureColumn(rendered, 'total', 150);

        expect(scrollTo()).not.toHaveBeenCalled();
        expect(nativeBody.offset).toBe(120);
        expect(offsetBox.value).toBe(120);
      });

      it('measures the rows afresh on a refill, with no measuring views while empty', async () => {
        const rendered = await settle(1);
        await rerenderTable(rendered, { initialColumnIndex: 1, ...emptied });

        expect(
          rendered.queryByTestId(`${PREFIX}-measure-layer`, { includeHiddenElements: true }),
        ).toBeNull();

        await rerenderTable(rendered, { initialColumnIndex: 1 });

        expect(
          rendered.getByTestId(`${PREFIX}-measure-layer`, { includeHiddenElements: true }),
        ).toBeTruthy();
      });

      it('follows the body only while there is one', async () => {
        const rendered = await settle(1);
        await rerenderTable(rendered, { initialColumnIndex: 1, ...emptied });

        expect(reanimated.useScrollOffset).toHaveBeenLastCalledWith(null);

        await rerenderTable(rendered, { initialColumnIndex: 1 });

        expect(reanimated.useScrollOffset).toHaveBeenLastCalledWith(
          expect.objectContaining({ current: expect.anything() }),
        );
      });
    });
  });

  describe('sticky header', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('puts the caption, the header and the body in the vertical scroll, in that order', async () => {
      const rendered = await renderTable();
      const vertical = rendered.getByTestId(`${PREFIX}-vertical-scroll`);
      const parts = within(vertical).getAllByTestId(/^table-(caption|header-row|body-row)$/, {
        includeHiddenElements: true,
      });

      expect(vertical.props.horizontal).toBeFalsy();
      expect(parts.map((part) => part.props.testID)).toEqual([
        `${PREFIX}-caption`,
        `${PREFIX}-header-row`,
        `${PREFIX}-body-row`,
      ]);
      expect(
        within(vertical).getByTestId(`${PREFIX}-header-jan`, { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(within(vertical).getByTestId(`${PREFIX}-cell-groceries-jan`)).toBeTruthy();
    });

    it('makes only the header row sticky, so the caption scrolls away', async () => {
      const rendered = await renderTable();

      expect(rendered.getByTestId(`${PREFIX}-vertical-scroll`).props.stickyHeaderIndices).toEqual([
        1,
      ]);
    });

    // The real sticky wrapper moves the child's style onto itself and gives the child a fill
    // style, so a row styled as the child itself would lose its direction. The Jest ScrollView does
    // not run that wrapper: this pins the nesting only, and the layout is measured on a device.
    it('makes a plain view with no style of its own the sticky child, holding the row', async () => {
      const rendered = await renderTable();
      const vertical = rendered.getByTestId(`${PREFIX}-vertical-scroll`);
      const row = rendered.getByTestId(`${PREFIX}-header-row`, { includeHiddenElements: true });
      const sticky = row.parent;
      const siblings = sticky?.parent?.children ?? [];

      expect(vertical.props.stickyHeaderIndices).toEqual([1]);
      expect(siblings.indexOf(sticky as never)).toBe(1);
      expect(sticky?.props.style).toBeUndefined();
      expect(sticky?.children).toHaveLength(1);
      expect(flat(row).flexDirection).toBe('row');
    });

    it('draws top content above the caption, both in the one child before the sticky header', async () => {
      const rendered = await renderTable({ topContent: <View testID="filters" /> });
      const top = rendered.getByTestId(`${PREFIX}-top`);
      const row = rendered.getByTestId(`${PREFIX}-header-row`, { includeHiddenElements: true });
      const siblings = top.parent?.children ?? [];

      expect(siblings.indexOf(top as never)).toBe(0);
      expect(siblings.indexOf(row.parent as never)).toBe(1);
      expect(
        within(top)
          .getAllByTestId(/^(filters|table-caption)$/)
          .map((part) => part.props.testID),
      ).toEqual(['filters', `${PREFIX}-caption`]);
      expect(rendered.getByTestId(`${PREFIX}-vertical-scroll`).props.stickyHeaderIndices).toEqual([
        1,
      ]);
    });

    it('keeps the caption as the table summary beside top content', async () => {
      const rendered = await renderTable({ topContent: <View testID="filters" /> });

      expect(rendered.getByText('Spending in UAH').props.accessibilityRole).toBe('summary');
    });

    it('keeps the same child count with no top content', async () => {
      const rendered = await renderTable();
      const top = rendered.getByTestId(`${PREFIX}-top`);

      expect(within(top).getByTestId(`${PREFIX}-caption`)).toBeTruthy();
      expect(top.parent?.children).toHaveLength(3);
    });

    describe('with empty content', () => {
      const emptyContent = <View testID="nothing-here" />;

      it('shows it in place of the caption, the header and the rows, under the top content', async () => {
        const rendered = await renderTable({ topContent: <View testID="filters" />, emptyContent });
        const top = rendered.getByTestId(`${PREFIX}-top`);

        expect(rendered.getByTestId('nothing-here')).toBeTruthy();
        expect(within(top).getByTestId('filters')).toBeTruthy();
        expect(rendered.queryByTestId(`${PREFIX}-caption`)).toBeNull();
        expect(
          rendered.queryByTestId(`${PREFIX}-header-row`, { includeHiddenElements: true }),
        ).toBeNull();
        expect(rendered.queryByTestId(`${PREFIX}-body-row`)).toBeNull();
        expect(
          rendered.getByTestId(`${PREFIX}-vertical-scroll`).props.stickyHeaderIndices,
        ).toBeUndefined();
      });

      it('lets the empty content fill the room under the top content', async () => {
        const rendered = await renderTable({ emptyContent });

        expect(
          flat({
            props: {
              style: rendered.getByTestId(`${PREFIX}-vertical-scroll`).props.contentContainerStyle,
            },
          }),
        ).toMatchObject({ flexGrow: 1 });
      });

      it('keeps the top content mounted when the table crosses to the empty content and back', async () => {
        const mounted = jest.fn();
        const unmounted = jest.fn();
        const Probe = () => {
          useEffect(() => {
            mounted();

            return unmounted;
          }, []);

          return <View testID="filters" />;
        };
        const rendered = await renderTable({ topContent: <Probe /> });

        await rendered.rerender(
          <DataTable {...baseProps} topContent={<Probe />} emptyContent={emptyContent} />,
        );
        await rendered.rerender(<DataTable {...baseProps} topContent={<Probe />} />);

        expect(rendered.getByTestId('filters')).toBeTruthy();
        expect(mounted).toHaveBeenCalledTimes(1);
        expect(unmounted).not.toHaveBeenCalled();
      });
    });

    it('gives the sticky header row an opaque surface ground', async () => {
      const rendered = await renderTable();
      const row = rendered.getByTestId(`${PREFIX}-header-row`, { includeHiddenElements: true });

      expect(flat(row).backgroundColor).toBe(darkTheme.colors.surface);
    });

    it('keeps the measuring layer outside the vertical scroll', async () => {
      const rendered = await renderTable();
      const vertical = rendered.getByTestId(`${PREFIX}-vertical-scroll`);

      expect(
        within(vertical).queryByTestId(`${PREFIX}-measure-layer`, { includeHiddenElements: true }),
      ).toBeNull();
    });

    it('moves the header by the negative live offset of the body', async () => {
      jest.spyOn(reanimated, 'useScrollOffset').mockReturnValue({ value: 120 } as never);
      const rendered = await renderTable();
      const track = rendered.getByTestId(`${PREFIX}-header-track`, { includeHiddenElements: true });

      expect(flat(track).transform).toEqual([{ translateX: -120 }]);
    });
  });

  describe('styling', () => {
    it('tints sum columns, header included, and no other column', async () => {
      const rendered = await renderTable();
      const header = rendered.getByTestId(`${PREFIX}-header-total`, {
        includeHiddenElements: true,
      });

      expect(flat(rendered.getByTestId(`${PREFIX}-cell-groceries-total`)).backgroundColor).toBe(
        darkTheme.colors.sheetBackground,
      );
      expect(flat(header).backgroundColor).toBe(darkTheme.colors.sheetBackground);
      expect(flat(rendered.getByTestId(`${PREFIX}-cell-groceries-jan`)).backgroundColor).not.toBe(
        darkTheme.colors.sheetBackground,
      );
    });

    it('bolds the summary row label and cells and no other row', async () => {
      const rendered = await renderTable();

      expect(flat(rendered.getByText('All')).fontWeight).toBe('700');
      expect(flat(rendered.getByText('300')).fontWeight).toBe('700');
      expect(flat(rendered.getByText('Groceries')).fontWeight).not.toBe('700');
      expect(flat(rendered.getByText('120')).fontWeight).not.toBe('700');
    });
  });

  describe('accessibility', () => {
    it('gives each cell one element carrying its label and the full value', async () => {
      const rendered = await renderTable();
      const cell = rendered.getByLabelText('Groceries, 120');

      expect(cell.props.accessibilityValue).toEqual({ text: '120.00 UAH' });
      expect(cell.props.accessible).not.toBe(false);
    });

    it('gives a cell with onPress the button role and its hint', async () => {
      const onPress = jest.fn();
      const rendered = await renderTable({
        rows: [
          {
            key: 'row',
            label: 'Row',
            cells: makeCells(['1', '2', '3'], { onPress, accessibilityHint: 'Opens the rows' }),
          },
        ],
      });
      const cell = rendered.getByLabelText('Groceries, 1');
      await fireEvent.press(cell);

      expect(cell.props.accessibilityRole).toBe('button');
      expect(cell.props.accessibilityHint).toBe('Opens the rows');
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('gives a cell without onPress neither the button role nor a hint', async () => {
      const rendered = await renderTable({
        rows: [
          {
            key: 'row',
            label: 'Row',
            cells: makeCells(['1', '2', '3'], { accessibilityHint: 'Opens the rows' }),
          },
        ],
      });
      const cell = rendered.getByLabelText('Groceries, 1');

      expect(cell.props.accessibilityRole).toBeUndefined();
      expect(cell.props.accessibilityHint).toBeUndefined();
    });

    it('does not mark a cell without onPress as disabled, which VoiceOver reads as dimmed', async () => {
      const rendered = await renderTable();
      const cell = rendered.getByLabelText('Groceries, 120');

      expect(cell.props.accessibilityState?.disabled).not.toBe(true);
    });

    it('still fires onPress on a pressable cell that carries no disabled state', async () => {
      const onPress = jest.fn();
      const rendered = await renderTable({
        rows: [{ key: 'row', label: 'Row', cells: makeCells(['1', '2', '3'], { onPress }) }],
      });
      const cell = rendered.getByLabelText('Groceries, 1');
      await fireEvent.press(cell);

      expect(cell.props.accessibilityState?.disabled).not.toBe(true);
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('hides every header cell from VoiceOver', async () => {
      const rendered = await renderTable();

      for (const column of columns) {
        const header = rendered.getByTestId(`${PREFIX}-header-${column.key}`, {
          includeHiddenElements: true,
        });

        expect(header.props.accessibilityElementsHidden).toBe(true);
        expect(header.props.importantForAccessibility).toBe('no-hide-descendants');
      }
    });

    it('keeps the measuring layer out of VoiceOver and out of queries', async () => {
      const rendered = await renderTable();
      const layer = rendered.getByTestId(`${PREFIX}-measure-layer`, {
        includeHiddenElements: true,
      });

      expect(rendered.queryAllByText('120')).toHaveLength(1);
      expect(layer.props.accessibilityElementsHidden).toBe(true);
      expect(layer.props.importantForAccessibility).toBe('no-hide-descendants');
    });

    it('shows the caption as the table summary', async () => {
      const rendered = await renderTable();
      const caption = rendered.getByText('Spending in UAH');

      expect(caption.props.accessibilityRole).toBe('summary');
    });
  });

  describe('measured text height and font scaling', () => {
    it('keeps every text and lets a taller measured line grow the row', async () => {
      const rendered = await renderTable();
      await setContainerWidth(rendered, 400);
      await measureLabels(rendered, 300);
      await measureAllColumns(rendered, 220);
      await measureText(rendered, 'label-groceries', 240);

      expect(rendered.getByText('Groceries')).toBeTruthy();
      expect(rendered.getByText('Spending in UAH')).toBeTruthy();
      expect(rendered.getByText('-45')).toBeTruthy();
      expect(flat(rendered.getByTestId(`${PREFIX}-scrolled-row-groceries`)).minHeight).toBe(
        240 + VERTICAL_PADDING,
      );
    });

    it('never turns font scaling off on any text', async () => {
      const rendered = await renderTable();
      const texts = rendered.getAllByText(/./, { includeHiddenElements: true });

      expect(texts.length).toBeGreaterThan(0);

      for (const text of texts) {
        expect(text.props.allowFontScaling).not.toBe(false);
      }
    });
  });

  describe('theme tokens', () => {
    it('paints the fixed column with surface and its edge with border and the hairline', async () => {
      const rendered = await renderTable();
      const fixed = flat(rendered.getByTestId(`${PREFIX}-fixed-column`));

      expect(fixed.backgroundColor).toBe(darkTheme.colors.surface);
      expect(fixed.borderRightColor).toBe(darkTheme.colors.border);
      expect(fixed.borderRightWidth).toBe(darkTheme.layout.hairline);
    });

    it('paints header text with textSecondary and row separators with border', async () => {
      const rendered = await renderTable();
      const headerText = rendered.getByTestId(`${PREFIX}-header-text-jan`, {
        includeHiddenElements: true,
      });

      expect(flat(headerText).color).toBe(darkTheme.colors.textSecondary);
      expect(flat(rendered.getByTestId(`${PREFIX}-scrolled-row-groceries`)).borderBottomColor).toBe(
        darkTheme.colors.border,
      );
    });
  });

  describe('palette independence', () => {
    // Dark only: the store registers two themes, but the jest unistyles mock paints the first
    // registered one (dark), so a light row would fail on the mock rather than on the table. A
    // second palette also needs the render to switch theme, not only a row here.
    const themes = { dark: darkTheme };
    const tokenColors = (theme: typeof darkTheme) => new Set<unknown>(Object.values(theme.colors));
    const colorsIn = (element: { props: { style?: unknown } }) =>
      Object.entries(flat(element) ?? {})
        .filter(([property]) => property.toLowerCase().endsWith('color'))
        .map(([, value]) => value);

    it.each(Object.entries(themes))(
      'paints only %s theme tokens, never a literal',
      async (_name, theme) => {
        const rendered = await renderTable();
        const tokens = tokenColors(theme);
        const elements = [
          ...rendered.getAllByTestId(/^table/, { includeHiddenElements: true }),
          rendered.getByText('Spending in UAH'),
        ];
        const colors = elements.flatMap(colorsIn);

        expect(colors.length).toBeGreaterThan(0);
        expect(colors.filter((color) => !tokens.has(color))).toEqual([]);
      },
    );

    it('catches a literal colour, so the check above is not vacuous', async () => {
      const rendered = await renderTable();
      const tokens = tokenColors(darkTheme);
      const literal = { props: { style: { backgroundColor: '#123456' } } };

      expect(colorsIn(literal).filter((color) => !tokens.has(color))).toEqual(['#123456']);
      expect(colorsIn(rendered.getByText('120')).length).toBeGreaterThan(0);
    });
  });
});
