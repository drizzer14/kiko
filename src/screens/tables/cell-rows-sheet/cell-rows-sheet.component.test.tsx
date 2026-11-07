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
  loanPart: 'interest',
};
const FEE: CellRow = {
  id: 'loan-excess:payment',
  time: COIN_TIME - 1,
  description: 'Mortgage payment',
  native: Money.of('UAH', 300),
  base: Money.of('UAH', 300),
  paymentId: 'payment',
  loanPart: 'fee',
};
// More rows than a sheet can mount at once: a 12-month Total on a synced card holds this many.
const MANY_ROWS = 400;

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

  it('says under the interest of a loan payment that it is interest, and under no other row', async () => {
    const { getByTestId } = await shown([COFFEE, INTEREST]);
    const interest = i18n.t('tables.cellRows.loanInterest');

    expect(within(getByTestId('cell-row-loan-interest:payment')).getByText(interest)).toBeTruthy();
    expect(within(getByTestId('cell-row-coffee')).queryByText(interest)).toBeNull();
  });

  it('says under the fee of a loan payment that it is a fee, and not interest', async () => {
    const { getByTestId } = await shown([INTEREST, FEE]);
    const fee = within(getByTestId('cell-row-loan-excess:payment'));

    expect(fee.getByText(i18n.t('tables.cellRows.loanFee'))).toBeTruthy();
    expect(fee.queryByText(i18n.t('tables.cellRows.loanInterest'))).toBeNull();
    expect(
      within(getByTestId('cell-row-loan-interest:payment')).queryByText(
        i18n.t('tables.cellRows.loanFee'),
      ),
    ).toBeNull();
  });

  it('mounts a window of the rows, never every one of a long list', async () => {
    const rows = Array.from({ length: MANY_ROWS }, (_unused, index) => ({
      ...COFFEE,
      id: `coffee-${index}`,
    }));
    const { getAllByTestId, getByTestId } = await shown(rows);

    expect(getAllByTestId(/^cell-row-/).length).toBeLessThan(MANY_ROWS);
    expect(getByTestId('cell-row-coffee-0')).toBeTruthy();
  });

  it('keeps the total of every row in view, though the list shows a window of them', async () => {
    const rows = Array.from({ length: MANY_ROWS }, (_unused, index) => ({
      ...COFFEE,
      id: `coffee-${index}`,
    }));
    const { getByTestId } = await shown(rows);

    expect(within(getByTestId('cell-rows-total')).getByText('6,000.00 ₴')).toBeTruthy();
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

    it('reads the total and the loan captions in the language', async () => {
      const { getByTestId } = await shown([COFFEE, INTEREST, FEE]);

      expect(within(getByTestId('cell-rows-total')).getByText(i18n.t('tables.total'))).toBeTruthy();
      expect(
        within(getByTestId('cell-row-loan-interest:payment')).getByText(
          i18n.t('tables.cellRows.loanInterest'),
        ),
      ).toBeTruthy();
      expect(
        within(getByTestId('cell-row-loan-excess:payment')).getByText(
          i18n.t('tables.cellRows.loanFee'),
        ),
      ).toBeTruthy();
      expect(i18n.t('tables.cellRows.loanFee')).not.toBe(
        i18n.t('tables.cellRows.loanFee', { lng: 'en' }),
      );
    });
  });
});
