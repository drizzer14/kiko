import { act, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import { Money } from '@kiko/currency/money';
import type { CellRow } from '@kiko/statistics/cell-rows';

import CellRowsSheet from '.';

const COFFEE_TIME = new Date(2025, 0, 20, 12).getTime();
const COIN_TIME = new Date(2025, 0, 10, 12).getTime();

const COFFEE: CellRow = {
  id: 'coffee',
  time: COFFEE_TIME,
  description: 'Coffee',
  native: Money.of('UAH', 1_500),
  base: Money.of('UAH', 1_500),
};
const COIN: CellRow = {
  id: 'coin',
  time: COIN_TIME,
  description: 'Coin purchase',
  native: Money.of('USDT', 250_000_000),
  base: Money.of('UAH', 10_000),
};
const INTEREST: CellRow = {
  id: 'loan-interest:payment',
  time: COIN_TIME - 1,
  description: 'Mortgage payment',
  native: Money.of('UAH', 9_000),
  base: Money.of('UAH', 9_000),
  paymentId: 'payment',
};

const shown = (rows: readonly CellRow[], visible = true) =>
  render(
    <CellRowsSheet
      visible={visible}
      title="Groceries, January 2025"
      rows={rows}
      baseCurrency="UAH"
      onDismiss={jest.fn()}
    />,
  );

describe('CellRowsSheet', () => {
  it('names the cell it is behind in its title', async () => {
    const { getByText } = await shown([COFFEE]);

    expect(getByText('Groceries, January 2025')).toBeTruthy();
  });

  it('lists the rows in the order it is given, each with its description, amount and date', async () => {
    const { getByTestId, getAllByTestId } = await shown([COFFEE, COIN]);

    expect(getAllByTestId(/^cell-row-/).map((row) => row.props.testID)).toEqual([
      'cell-row-coffee',
      'cell-row-coin',
    ]);
    const coffee = within(getByTestId('cell-row-coffee'));

    expect(coffee.getByText('Coffee')).toBeTruthy();
    expect(coffee.getByText('15.00 ₴')).toBeTruthy();
    expect(coffee.getByText(formatDate(COFFEE_TIME))).toBeTruthy();
  });

  it('shows the amount in its own currency under a row of another currency', async () => {
    const { getByTestId } = await shown([COFFEE, COIN]);

    expect(within(getByTestId('cell-row-coin')).getByText('₮2.50')).toBeTruthy();
    expect(within(getByTestId('cell-row-coin')).getByText('100.00 ₴')).toBeTruthy();
  });

  it('shows no second amount under a row already in the base currency', async () => {
    const { getByTestId } = await shown([COFFEE]);

    expect(within(getByTestId('cell-row-coffee')).getAllByText(/₴/)).toHaveLength(1);
  });

  it('adds the base amounts into a total', async () => {
    const { getByTestId } = await shown([COFFEE, COIN, INTEREST]);
    const total = within(getByTestId('cell-rows-total'));

    expect(total.getByText('Total')).toBeTruthy();
    expect(total.getByText('205.00 ₴')).toBeTruthy();
  });

  it('says so under a row that is part of a loan payment, and under no other', async () => {
    const { getByTestId } = await shown([COFFEE, INTEREST]);

    expect(
      within(getByTestId('cell-row-loan-interest:payment')).getByText('Part of a loan payment.'),
    ).toBeTruthy();
    expect(
      within(getByTestId('cell-row-coffee')).queryByText('Part of a loan payment.'),
    ).toBeNull();
  });

  it('writes a row with no description as such', async () => {
    const { getByTestId } = await shown([{ ...COFFEE, description: '' }]);

    expect(within(getByTestId('cell-row-coffee')).getByText('No description')).toBeTruthy();
  });

  it('is read-only: no row can be pressed', async () => {
    const { getByTestId } = await shown([COFFEE, COIN]);

    expect(within(getByTestId('cell-rows-sheet')).queryAllByRole('button')).toEqual([]);
  });

  it('shows nothing while it is not visible', async () => {
    const { queryByText } = await shown([COFFEE], false);

    expect(queryByText('Coffee')).toBeNull();
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

    it('reads the total, the missing description and the loan caption in the language', async () => {
      const { getByTestId } = await shown([{ ...COFFEE, description: '' }, INTEREST]);

      expect(within(getByTestId('cell-rows-total')).getByText('Разом')).toBeTruthy();
      expect(within(getByTestId('cell-row-coffee')).getByText('Без опису')).toBeTruthy();
      expect(
        within(getByTestId('cell-row-loan-interest:payment')).getByText(
          'Частина платежу за кредитом.',
        ),
      ).toBeTruthy();
    });
  });
});
