import { act, fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import {
  registerLightThemeFirst,
  restoreThemeOrder,
} from '@kiko/test-support/light-theme-registered';
import { formatDate, formatDateTime } from '@kiko/dates';
import type { CellRow } from '@kiko/statistics/cell-rows';
import { markColor } from '@kiko/design-system/entity-tint';
import { glyphNamesWithin } from '@kiko/test-support/glyphs-within';
import type { CategoryDisplay } from '@kiko/categories/category-display';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';

import CellRowsSheet from '.';

const CLOCK = { uses24Hour: true } as const;

jest.mock('@kiko/i18n/use-time-clock', () => ({ useTimeClock: () => ({ uses24Hour: true }) }));

const HEX = /^#[0-9a-f]{6}$/i;

const COFFEE_TIME = new Date(2025, 0, 20, 14, 5).getTime();
const COIN_TIME = new Date(2025, 0, 10, 12).getTime();

const CATEGORY_DISPLAY: ReadonlyMap<string, CategoryDisplay> = new Map([
  ['groceries', { title: 'Groceries', icon: 'cart', color: '#0A84FF' }],
  ['loan_interest', { title: 'Loan interest', icon: 'percent', color: null }],
  ['utilities', { title: 'Utilities', icon: 'bolt', color: null }],
  ['other', { title: 'Other', icon: 'tray', color: null }],
]);

const COFFEE: CellRow = {
  id: 'coffee',
  transactionId: 'coffee',
  time: COFFEE_TIME,
  description: 'Coffee',
  native: Money.of('UAH', 1_500),
  base: Money.of('UAH', 1_500),
  category: 'groceries',
  accountName: 'Monobank',
  holdingType: 'card',
  loanHoldingId: null,
  flow: 'expense',
};
const COIN: CellRow = {
  id: 'coin',
  transactionId: 'coin',
  time: COIN_TIME,
  description: 'Coin purchase',
  native: Money.of('USDT', 250_000_000),
  base: Money.of('UAH', 10_000),
  category: null,
  accountName: 'Binance',
  holdingType: 'crypto_asset',
  loanHoldingId: null,
  flow: 'expense',
};
const SALARY: CellRow = {
  ...COFFEE,
  id: 'salary',
  transactionId: 'salary',
  description: 'Salary',
  native: Money.of('UAH', 30_000),
  base: Money.of('UAH', 30_000),
  category: null,
  flow: 'income',
};
const TIP: CellRow = {
  ...COIN,
  id: 'tip',
  transactionId: 'tip',
  description: 'Tip',
  flow: 'income',
};
const INTEREST: CellRow = {
  id: 'loan-interest:payment',
  transactionId: 'payment',
  time: COIN_TIME - 1,
  description: 'Mortgage payment',
  native: Money.of('UAH', 9_000),
  base: Money.of('UAH', 9_000),
  loanPart: 'interest',
  category: 'loan_interest',
  accountName: 'Monobank',
  holdingType: 'card',
  loanHoldingId: 'loan',
  flow: 'expense',
};
const FEE: CellRow = {
  id: 'loan-excess:payment',
  transactionId: 'payment',
  time: COIN_TIME - 1,
  description: 'Mortgage payment',
  native: Money.of('UAH', 300),
  base: Money.of('UAH', 300),
  loanPart: 'fee',
  category: 'utilities',
  accountName: 'Monobank',
  holdingType: 'card',
  loanHoldingId: 'loan',
  flow: 'expense',
};
const DEPOSIT: CellRow = {
  ...COFFEE,
  id: 'deposit',
  transactionId: 'deposit',
  description: 'Deposit top-up',
  holdingType: 'term_deposit',
};
const UNKNOWN_HOLDING: CellRow = {
  ...COFFEE,
  id: 'unknown-holding',
  transactionId: 'unknown-holding',
  description: 'Orphan',
  accountName: '',
  holdingType: null,
};
// More rows than a sheet can mount at once: a 12-month Total on a synced card holds this many.
const MANY_ROWS = 400;

const onPressRow = jest.fn();
const onClosed = jest.fn();

const shown = (rows: readonly CellRow[], visible = true) =>
  render(
    <CellRowsSheet
      visible={visible}
      title="Groceries, January 2025"
      rows={rows}
      baseCurrency="UAH"
      categoryDisplay={CATEGORY_DISPLAY}
      defaultCategoryKey="other"
      onDismiss={jest.fn()}
      onPressRow={onPressRow}
      onClosed={onClosed}
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
    expect(coffee.getByText('-15.00 ₴')).toBeTruthy();
    expect(coffee.getByText(formatDateTime(COFFEE_TIME, CLOCK))).toBeTruthy();
  });

  it("shows each row's category icon, named for a screen reader", async () => {
    const { getByTestId } = await shown([COFFEE, COIN]);

    const groceries = within(getByTestId('cell-row-coffee')).getByLabelText('Groceries');
    const fallback = within(getByTestId('cell-row-coin')).getByLabelText('Other');

    expect(groceries.props.name).toBe('cart');
    expect(fallback.props.name).toBe('tray');
  });

  it('reads the footer as "account · category" and the date and time', async () => {
    const { getByTestId } = await shown([COFFEE]);
    const coffee = within(getByTestId('cell-row-coffee'));

    expect(coffee.getByText('Monobank · Groceries')).toBeTruthy();
    expect(coffee.getByText('20.01.2025 14:05')).toBeTruthy();
  });

  it('shows only the date on a row of a time-exempt or unknown holding', async () => {
    const { getByTestId } = await shown([DEPOSIT, UNKNOWN_HOLDING]);

    for (const id of ['deposit', 'unknown-holding']) {
      const row = within(getByTestId(`cell-row-${id}`));

      expect(row.getByText(formatDate(COFFEE_TIME))).toBeTruthy();
      expect(row.queryByText(formatDateTime(COFFEE_TIME, CLOCK))).toBeNull();
    }
  });

  it('reads the footer as the category alone on a row with no account name', async () => {
    const { getByTestId } = await shown([UNKNOWN_HOLDING]);
    const row = within(getByTestId('cell-row-unknown-holding'));

    expect(row.getByText('Groceries')).toBeTruthy();
    expect(row.queryByText(/·/)).toBeNull();
  });

  it("shows the loan-link marker on a linked payment's entries", async () => {
    // The marker is the glyph beside the footer text; the category glyph is outside that box.
    const hasMarker = async (row: CellRow) => {
      const { getByTestId } = await shown([row]);
      const footerText = within(getByTestId(`cell-row-${row.id}`)).getByText(/Monobank/);

      return glyphNamesWithin(ancestorWithStyle(footerText, 'flex')).includes('link');
    };

    expect(await hasMarker(INTEREST)).toBe(true);
    expect(await hasMarker(FEE)).toBe(true);
    expect(await hasMarker(COFFEE)).toBe(false);
  });

  it('shows an expense as negative and income as positive, while the total adds the base amounts', async () => {
    const { getByTestId } = await shown([COFFEE, SALARY]);

    expect(within(getByTestId('cell-row-coffee')).getByText('-15.00 ₴')).toBeTruthy();
    expect(within(getByTestId('cell-row-salary')).getByText('300.00 ₴')).toBeTruthy();
    expect(within(getByTestId('cell-rows-total')).getByText('315.00 ₴')).toBeTruthy();
  });

  it('shows the amount in its own currency under a row of another currency', async () => {
    const { getByTestId } = await shown([COFFEE, COIN]);
    const coin = within(getByTestId('cell-row-coin'));

    expect(coin.getByText('-₮2.50')).toBeTruthy();
    expect(coin.getByText('-100.00 ₴')).toBeTruthy();
  });

  it('signs the amount in its own currency as it signs the base amount', async () => {
    const { getByTestId } = await shown([COIN, TIP]);

    expect(within(getByTestId('cell-row-coin')).getByText('-₮2.50')).toBeTruthy();
    expect(within(getByTestId('cell-row-tip')).getByText('₮2.50')).toBeTruthy();
    expect(within(getByTestId('cell-row-tip')).getByText('100.00 ₴')).toBeTruthy();
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

  it('names the loan part in the footer in place of the category, on an interest entry only', async () => {
    const { getByTestId } = await shown([COFFEE, INTEREST]);
    const interest = i18n.t('tables.cellRows.loanInterest');
    const row = within(getByTestId('cell-row-loan-interest:payment'));

    expect(row.getByText(`Monobank · ${interest}`)).toBeTruthy();
    expect(within(getByTestId('cell-row-coffee')).queryByText(new RegExp(interest))).toBeNull();
  });

  it('names a fee in the footer as a fee, not as interest or as its own category', async () => {
    const { getByTestId } = await shown([INTEREST, FEE]);
    const fee = within(getByTestId('cell-row-loan-excess:payment'));

    expect(fee.getByText(`Monobank · ${i18n.t('tables.cellRows.loanFee')}`)).toBeTruthy();
    expect(fee.queryByText(/Utilities/)).toBeNull();
    expect(fee.queryByText(new RegExp(i18n.t('tables.cellRows.loanInterest')))).toBeNull();
    expect(
      within(getByTestId('cell-row-loan-interest:payment')).queryByText(
        new RegExp(i18n.t('tables.cellRows.loanFee')),
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
    expect(within(getByTestId('cell-rows-list')).queryByTestId('cell-rows-total')).toBeNull();
  });

  it('hands a pressed row to onPressRow', async () => {
    const { getByTestId } = await shown([COFFEE, COIN]);

    await fireEvent.press(getByTestId('cell-row-coffee'));

    expect(onPressRow).toHaveBeenCalledTimes(1);
    expect(onPressRow).toHaveBeenCalledWith(COFFEE);
  });

  it('makes each row a button', async () => {
    const { getByTestId } = await shown([COFFEE, COIN]);

    expect(within(getByTestId('cell-rows-sheet')).getAllByRole('button')).toHaveLength(2);
  });

  it('calls onClosed when its sheet has finished closing', async () => {
    const { getByTestId } = await shown([COFFEE]);

    await fireEvent(getByTestId('cell-rows-sheet-modal'), 'dismiss');

    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('shows nothing while it is not visible', async () => {
    const { queryByText } = await shown([COFFEE], false);

    expect(queryByText('Coffee')).toBeNull();
  });

  describe('in the light scheme', () => {
    beforeEach(() => {
      registerLightThemeFirst();
    });

    afterEach(() => {
      restoreThemeOrder();
    });

    it('tints each category icon with a hex colour in the light scheme', async () => {
      const unknown: CellRow = { ...COIN, id: 'unknown', category: 'gone' };
      const { getByTestId } = await shown([COFFEE, COIN, unknown]);
      const tintOf = (id: string, label: string) =>
        within(getByTestId(`cell-row-${id}`)).getByLabelText(label).props.tintColor;

      // A stored colour, a row with no category and a slug no category carries all resolve, and
      // none throws as the templates' light render did.
      const stored = tintOf('coffee', 'Groceries');
      const fromNull = tintOf('coin', 'Other');
      const fromUnknown = tintOf('unknown', 'Other');

      expect(stored).toBe(
        markColor(resolveCategoryColor('#0A84FF', 'groceries', 'light'), 'light'),
      );
      expect(fromNull).toBe(markColor(resolveCategoryColor(null, 'other', 'light'), 'light'));
      expect(fromUnknown).toBe(fromNull);

      for (const tint of [stored, fromNull, fromUnknown]) {
        expect(tint).toMatch(HEX);
      }
    });
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
          `Monobank · ${i18n.t('tables.cellRows.loanInterest')}`,
        ),
      ).toBeTruthy();
      expect(
        within(getByTestId('cell-row-loan-excess:payment')).getByText(
          `Monobank · ${i18n.t('tables.cellRows.loanFee')}`,
        ),
      ).toBeTruthy();
      expect(i18n.t('tables.cellRows.loanFee')).not.toBe(
        i18n.t('tables.cellRows.loanFee', { lng: 'en' }),
      );
    });
  });
});
