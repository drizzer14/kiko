import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme, lightTheme } from '@kiko/design-system/theme';

import DataTable from '.';
import type { DataTableProps } from './data-table.props';

const PREFIX = 'table';

const columns: DataTableProps['columns'] = [
  { key: 'jan', header: 'Jan' },
  { key: 'feb', header: 'Feb' },
  { key: 'total', header: 'Total', isSum: true },
];

const rowOf = (key: string, isSummary = false): DataTableProps['rows'][number] => ({
  key,
  label: key,
  isSummary,
  cells: ['1', '2', '3'].map((text) => ({
    text,
    accessibilityLabel: `${key}, ${text}`,
    accessibilityValue: `${text}.00`,
  })),
});

const props: DataTableProps = {
  columns,
  caption: 'Caption',
  rows: [rowOf('a'), rowOf('b'), rowOf('c'), rowOf('all', true)],
  testID: PREFIX,
};

const flat = (element: { props: { style?: unknown } }) =>
  StyleSheet.flatten(element.props.style as never) as Record<string, unknown>;

const layoutEvent = (width: number, height = 0) => ({
  nativeEvent: { layout: { x: 0, y: 0, width, height } },
});

const renderTable = async () => render(<DataTable {...props} />);

const hidden = { includeHiddenElements: true };

describe('DataTable rows and column lines', () => {
  describe('alternate row ground', () => {
    it('bands the odd body rows in the fixed column and the scrolled cells alike', async () => {
      const rendered = await renderTable();

      for (const kind of ['fixed-row', 'scrolled-row']) {
        expect(flat(rendered.getByTestId(`${PREFIX}-${kind}-a`)).backgroundColor).toBeUndefined();
        expect(flat(rendered.getByTestId(`${PREFIX}-${kind}-b`)).backgroundColor).toBe(
          darkTheme.colors.rowBand,
        );
        expect(flat(rendered.getByTestId(`${PREFIX}-${kind}-c`)).backgroundColor).toBeUndefined();
      }
    });

    it('leaves the total row and the header row out of the banding', async () => {
      const rendered = await renderTable();

      // The total row is the fourth, an odd index, and is still plain.
      expect(flat(rendered.getByTestId(`${PREFIX}-fixed-row-all`)).backgroundColor).toBeUndefined();
      expect(
        flat(rendered.getByTestId(`${PREFIX}-scrolled-row-all`)).backgroundColor,
      ).toBeUndefined();
      expect(flat(rendered.getByTestId(`${PREFIX}-header-row`)).backgroundColor).toBe(
        darkTheme.colors.surface,
      );
    });

    it('lets the band run across a sum column, which keeps a translucent tint of its own', async () => {
      const rendered = await renderTable();
      const bandedRowGround = flat(
        rendered.getByTestId(`${PREFIX}-scrolled-row-b`),
      ).backgroundColor;

      expect(bandedRowGround).toBe(darkTheme.colors.rowBand);

      for (const row of ['a', 'b']) {
        const sumGround = flat(rendered.getByTestId(`${PREFIX}-cell-${row}-total`)).backgroundColor;

        expect(sumGround).toBe(darkTheme.colors.sumTint);
        expect(
          flat(rendered.getByTestId(`${PREFIX}-cell-${row}-jan`)).backgroundColor,
        ).toBeUndefined();
      }

      // A fill with alpha below one lets the row's band show through, in both themes.
      for (const theme of [darkTheme, lightTheme]) {
        expect(theme.colors.sumTint).toMatch(/^rgba\(.+,0?\.\d+\)$/);
        expect(theme.colors.sumTint).not.toBe(theme.colors.sheetBackground);
      }
    });

    it('keeps the scroll content growing to the room beside the fixed column', async () => {
      const rendered = await renderTable();
      const scroll = rendered.getByTestId(`${PREFIX}-body-scroll`);

      expect(StyleSheet.flatten(scroll.props.contentContainerStyle).flexGrow).toBe(1);
    });

    it('keeps the body content growing to the room beside the fixed column', async () => {
      const rendered = await renderTable();

      expect(flat(rendered.getByTestId(`${PREFIX}-body-content`)).flexGrow).toBe(1);
    });
  });

  describe('column separators', () => {
    it('draws one per column edge in the body and in the header, none after the last', async () => {
      const rendered = await renderTable();

      expect(rendered.queryByTestId(`${PREFIX}-separator-jan`)).toBeTruthy();
      expect(rendered.queryByTestId(`${PREFIX}-separator-feb`)).toBeTruthy();
      expect(rendered.queryByTestId(`${PREFIX}-separator-total`)).toBeNull();
      expect(rendered.queryByTestId(`${PREFIX}-header-separator-jan`, hidden)).toBeTruthy();
      expect(rendered.queryByTestId(`${PREFIX}-header-separator-feb`, hidden)).toBeTruthy();
      expect(rendered.queryByTestId(`${PREFIX}-header-separator-total`, hidden)).toBeNull();
      // None per cell: the lines are two tracks of columns - 1 views, not one per row.
      expect(rendered.queryByTestId(`${PREFIX}-separator-a-jan`)).toBeNull();
    });

    it('is a full-height hairline of the border colour at each running column edge', async () => {
      const rendered = await renderTable();

      await fireEvent(rendered.getByTestId(PREFIX), 'layout', layoutEvent(400, 600));
      await fireEvent(
        rendered.getByTestId(`${PREFIX}-measure-labels`, hidden),
        'layout',
        layoutEvent(60),
      );

      const widths = [50, 70, 90];

      for (const [index, column] of columns.entries()) {
        await fireEvent(
          rendered.getByTestId(`${PREFIX}-measure-column-${column.key}`, hidden),
          'layout',
          layoutEvent(widths[index]),
        );
      }

      const padding = darkTheme.spacing(4);
      const edges = [50 + padding, 50 + padding + 70 + padding].map(
        (edge) => edge - darkTheme.layout.hairline,
      );

      for (const [index, key] of ['jan', 'feb'].entries()) {
        for (const line of [
          flat(rendered.getByTestId(`${PREFIX}-separator-${key}`)),
          flat(rendered.getByTestId(`${PREFIX}-header-separator-${key}`, hidden)),
        ]) {
          expect(line.position).toBe('absolute');
          expect(line.top).toBe(0);
          expect(line.bottom).toBe(0);
          expect(line.width).toBe(darkTheme.layout.hairline);
          expect(line.left).toBe(edges[index]);
          expect(line.backgroundColor).toBe(darkTheme.colors.border);
        }
      }
    });

    it('never touches a pointer, so a cell press still reaches the cell', async () => {
      const rendered = await renderTable();

      expect(rendered.getByTestId(`${PREFIX}-separator-jan`).props.pointerEvents).toBe('none');
      expect(
        rendered.getByTestId(`${PREFIX}-header-separator-jan`, hidden).props.pointerEvents,
      ).toBe('none');
    });

    it('leaves the column and the first-column widths as they were', async () => {
      const rendered = await renderTable();

      await fireEvent(rendered.getByTestId(PREFIX), 'layout', layoutEvent(400, 600));
      await fireEvent(
        rendered.getByTestId(`${PREFIX}-measure-labels`, hidden),
        'layout',
        layoutEvent(60),
      );

      for (const column of columns) {
        await fireEvent(
          rendered.getByTestId(`${PREFIX}-measure-column-${column.key}`, hidden),
          'layout',
          layoutEvent(50),
        );
      }

      const padding = darkTheme.spacing(4);

      for (const column of columns) {
        expect(flat(rendered.getByTestId(`${PREFIX}-cell-a-${column.key}`)).width).toBe(
          50 + padding,
        );
        expect(flat(rendered.getByTestId(`${PREFIX}-header-${column.key}`, hidden)).width).toBe(
          50 + padding,
        );
      }

      expect(flat(rendered.getByTestId(`${PREFIX}-fixed-column`)).width).toBe(
        60 + padding + darkTheme.layout.hairline,
      );
    });
  });
});
