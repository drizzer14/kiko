import { type ReactTestInstance, render } from '@testing-library/react-native';
import { Money } from '../../../currency/money';
import '../../unistyles';
import CurrencyBreakdown from './currency-breakdown.component';

// Flatten a (possibly nested/array) style prop into its plain object layers so a
// test can assert a single directive regardless of how Unistyles composed it.
const styleLayers = (style: unknown): Record<string, unknown>[] =>
  (Array.isArray(style) ? style.flat(Number.POSITIVE_INFINITY) : [style]).filter(
    (layer): layer is Record<string, unknown> => layer != null && typeof layer === 'object',
  );

// Walk up from a node to the nearest ancestor whose flattened style satisfies
// `predicate` — used to find the cell (the code+amount row) and the table row
// that holds the two columns.
const ancestorWith = (
  node: ReactTestInstance,
  predicate: (layer: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined => {
  let current: ReactTestInstance | null = node.parent;
  while (current) {
    const match = styleLayers(current.props.style).find(predicate);
    if (match) return match;
    current = current.parent;
  }

  return undefined;
};

describe('CurrencyBreakdown', () => {
  it('renders each currency label with its formatted amount', async () => {
    const { getByText } = await render(
      <CurrencyBreakdown items={[Money.of('UAH', 12500), Money.of('USD', 5000)]} />,
    );

    expect(getByText('UAH')).toBeTruthy();
    expect(getByText(/125\.00/)).toBeTruthy();
    expect(getByText('USD')).toBeTruthy();
    expect(getByText(/\$50\.00/)).toBeTruthy();
  });

  it('lays the currencies out as a two-column table', async () => {
    const { toJSON } = await render(
      <CurrencyBreakdown
        items={[
          Money.of('UAH', 12500),
          Money.of('USD', 5000),
          Money.of('EUR', 3000),
          Money.of('BTC', 100000000),
        ]}
      />,
    );

    const table = toJSON();
    // The table is a row whose direct children are exactly the two columns.
    expect(styleLayers(table?.props.style).some((layer) => layer.flexDirection === 'row')).toBe(
      true,
    );
    expect(table?.children).toHaveLength(2);
  });

  it('aligns each currency code and amount as a space-between cell', async () => {
    const { getByText } = await render(<CurrencyBreakdown items={[Money.of('UAH', 12500)]} />);

    const cell = ancestorWith(
      getByText('UAH'),
      (layer) => layer.justifyContent === 'space-between',
    );

    expect(cell).toBeTruthy();
  });

  it('renders nothing when there are no items', async () => {
    const { queryByText } = await render(<CurrencyBreakdown items={[]} />);

    expect(queryByText('UAH')).toBeNull();
  });
});
