import '../../i18n';
import { i18n } from '../../i18n';

import { transactionRowDescription } from './row-description';

const holdingNameById = new Map([['h-usd', 'Savings']]);

const row = (
  overrides: Partial<Parameters<typeof transactionRowDescription>[0]['transaction']>,
) => ({
  description: '',
  amountMinorUnits: -1_000_000,
  exchangeCounterpartHoldingId: null,
  ...overrides,
});

describe('transactionRowDescription', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('prefers a stored description over every fallback', () => {
    expect(
      transactionRowDescription({
        transaction: row({ description: 'Coffee', exchangeCounterpartHoldingId: 'h-usd' }),
        holdingName: 'Black card',
        holdingNameById,
        t: i18n.t,
      }),
    ).toBe('Coffee');
  });

  it('labels an unlabelled exchange leg from its counterpart holding', () => {
    expect(
      transactionRowDescription({
        transaction: row({ exchangeCounterpartHoldingId: 'h-usd' }),
        holdingName: 'Black card',
        holdingNameById,
        t: i18n.t,
      }),
    ).toBe('Exchange to Savings');
  });

  it('falls back to the holding-name default for an ordinary unlabelled row', () => {
    expect(
      transactionRowDescription({
        transaction: row({}),
        holdingName: 'Black card',
        holdingNameById,
        t: i18n.t,
      }),
    ).toBe('Black card expense');
  });

  it('renders an exchange leg whose counterpart holding is gone without its name', () => {
    // A deleted counterpart leaves the marker pointing at nothing. The row must
    // still read as an exchange (it is not spending) rather than crash or fall
    // back to the holding-name default, which would mislabel it as an expense.
    expect(
      transactionRowDescription({
        transaction: row({ exchangeCounterpartHoldingId: 'gone' }),
        holdingName: 'Black card',
        holdingNameById,
        t: i18n.t,
      }),
    ).toBe(i18n.t('transactions.exchangeTo', { name: '' }));
  });
});
