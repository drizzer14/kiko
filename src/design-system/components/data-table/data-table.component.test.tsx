import { ScrollView, StyleSheet } from 'react-native';
import * as reanimated from 'react-native-reanimated';
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
        60 + HORIZONTAL_PADDING,
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

    it('finds the amount element, so the absent props above are read off the real cell', async () => {
      const rendered = await renderTable();
      const amount = rendered.getByText('120');

      expect(amount.props.children).toBe('120');
      expect(amount.props.allowFontScaling).not.toBe(false);
      expect(amount.props.style).toBeDefined();
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

    it('scrolls so the chosen column sits at the fixed column, from measured widths', async () => {
      await settle(1);

      expect(scrollTo()).toHaveBeenCalledWith({
        x: 80 + HORIZONTAL_PADDING,
        y: 0,
        animated: false,
      });
    });

    it('does not scroll further than the content allows', async () => {
      await settle(2);

      // Widths 96 + 116 + 156 = 368 in 300 - 76 = 224 of room, so the furthest offset is 144.
      expect(scrollTo()).toHaveBeenCalledWith({ x: 144, y: 0, animated: false });
    });

    it('stays at the start when no initial column is given', async () => {
      await settle(undefined);

      expect(scrollTo()).not.toHaveBeenCalled();
    });
  });

  describe('sticky header', () => {
    it('keeps the header outside the vertical scroll', async () => {
      const rendered = await renderTable();
      const vertical = rendered.getByTestId(`${PREFIX}-vertical-scroll`);

      expect(vertical.props.horizontal).toBeFalsy();
      expect(
        within(vertical).queryByTestId(`${PREFIX}-header-jan`, { includeHiddenElements: true }),
      ).toBeNull();
      expect(within(vertical).getByTestId(`${PREFIX}-cell-groceries-jan`)).toBeTruthy();
      expect(
        rendered.getByTestId(`${PREFIX}-header-jan`, { includeHiddenElements: true }),
      ).toBeTruthy();
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
      const rendered = await renderTable();
      const cell = rendered.getByLabelText('Groceries, 120');

      expect(cell.props.accessibilityRole).toBeUndefined();
      expect(cell.props.accessibilityHint).toBeUndefined();
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

  describe('Dynamic Type', () => {
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
    // Every theme the store offers today; a light palette adds a row here and nothing else.
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
