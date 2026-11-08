import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

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

    it('keeps a sum column its own tint on a banded row', async () => {
      const rendered = await renderTable();

      expect(flat(rendered.getByTestId(`${PREFIX}-cell-b-total`)).backgroundColor).toBe(
        darkTheme.colors.sheetBackground,
      );
    });
  });

  describe('column separators', () => {
    it('draws one on every body cell and header cell but the last column', async () => {
      const rendered = await renderTable();

      for (const row of ['a', 'b', 'all']) {
        expect(rendered.queryByTestId(`${PREFIX}-separator-${row}-jan`)).toBeTruthy();
        expect(rendered.queryByTestId(`${PREFIX}-separator-${row}-feb`)).toBeTruthy();
        expect(rendered.queryByTestId(`${PREFIX}-separator-${row}-total`)).toBeNull();
      }

      expect(rendered.queryByTestId(`${PREFIX}-header-separator-jan`, hidden)).toBeTruthy();
      expect(rendered.queryByTestId(`${PREFIX}-header-separator-feb`, hidden)).toBeTruthy();
      expect(rendered.queryByTestId(`${PREFIX}-header-separator-total`, hidden)).toBeNull();
    });

    it('is a hairline of the border colour on the right edge, out of the layout', async () => {
      const rendered = await renderTable();
      const style = flat(rendered.getByTestId(`${PREFIX}-separator-a-jan`));
      const headerStyle = flat(rendered.getByTestId(`${PREFIX}-header-separator-jan`, hidden));

      for (const line of [style, headerStyle]) {
        expect(line.position).toBe('absolute');
        expect(line.width).toBe(darkTheme.layout.hairline);
        expect(line.right).toBe(0);
        expect(line.backgroundColor).toBe(darkTheme.colors.border);
      }
    });

    it('never touches a pointer, so a cell press still reaches the cell', async () => {
      const rendered = await renderTable();

      expect(rendered.getByTestId(`${PREFIX}-separator-a-jan`).props.pointerEvents).toBe('none');
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
