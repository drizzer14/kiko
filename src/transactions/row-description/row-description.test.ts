import { i18n } from '@kiko/i18n/init';

import { transactionRowDescription } from './row-description';

const holdingNameById = new Map([
  ['h-usd', 'Savings'],
  ['h-spot', 'Bitcoin'],
  ['h-funding', 'Binance Funding'],
]);
const holdingCurrencyById = new Map([
  ['h-card', 'UAH'],
  ['h-usd', 'USD'],
  ['h-uah', 'UAH'],
  ['h-spot', 'BTC'],
  ['h-funding', 'BTC'],
]);

const row = (
  overrides: Partial<Parameters<typeof transactionRowDescription>[0]['transaction']>,
) => ({
  holdingId: 'h-card',
  description: '',
  amountMinorUnits: -1_000_000,
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
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
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe('Coffee');
  });

  it('prefers a stored description over an untracked wallet code', () => {
    expect(
      transactionRowDescription({
        transaction: row({ description: 'Coffee', untrackedCounterpart: 'wallet:UMFUTURE' }),
        holdingName: 'Black card',
        holdingNameById,
        holdingCurrencyById,
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
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe('Exchange to Savings');
  });

  it('reads an outgoing leg between two holdings of one currency as a transfer', () => {
    expect(
      transactionRowDescription({
        transaction: row({
          holdingId: 'h-spot',
          amountMinorUnits: -100_000,
          exchangeCounterpartHoldingId: 'h-funding',
        }),
        holdingName: 'Bitcoin',
        holdingNameById,
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe('Transfer to Binance Funding');
  });

  it('reads an incoming leg between two holdings of one currency as a transfer', () => {
    expect(
      transactionRowDescription({
        transaction: row({
          holdingId: 'h-funding',
          amountMinorUnits: 100_000,
          exchangeCounterpartHoldingId: 'h-spot',
        }),
        holdingName: 'Binance Funding',
        holdingNameById,
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe('Transfer from Bitcoin');
  });

  it('reads a MANUAL exchange leg between two holdings of one currency as a transfer too', () => {
    // The currency rule is general: it relabels the legs of a same-currency
    // Exchange a user recorded by hand, not only a synced Binance move.
    expect(
      transactionRowDescription({
        transaction: row({ exchangeCounterpartHoldingId: 'h-uah' }),
        holdingName: 'Black card',
        holdingNameById: new Map([['h-uah', 'Cash']]),
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe('Transfer to Cash');
  });

  it('keeps the exchange wording when the counterpart currency is unknown', () => {
    expect(
      transactionRowDescription({
        transaction: row({ exchangeCounterpartHoldingId: 'h-usd' }),
        holdingName: 'Black card',
        holdingNameById,
        holdingCurrencyById: new Map([['h-card', 'UAH']]),
        t: i18n.t,
      }),
    ).toBe('Exchange to Savings');
  });

  it('keeps the exchange wording when the leg own currency is unknown', () => {
    expect(
      transactionRowDescription({
        transaction: row({ holdingId: 'h-gone', exchangeCounterpartHoldingId: 'h-uah' }),
        holdingName: 'Black card',
        holdingNameById: new Map([['h-uah', 'Cash']]),
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe('Exchange to Cash');
  });

  it('keeps the exchange wording when neither holding is known', () => {
    expect(
      transactionRowDescription({
        transaction: row({ holdingId: 'h-gone', exchangeCounterpartHoldingId: 'h-also-gone' }),
        holdingName: 'Black card',
        holdingNameById,
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe(i18n.t('transactions.exchangeTo', { name: '' }));
  });

  it('labels an outgoing move to an untracked wallet by its product name', () => {
    expect(
      transactionRowDescription({
        transaction: row({
          holdingId: 'h-spot',
          amountMinorUnits: -100_000,
          untrackedCounterpart: 'wallet:UMFUTURE',
        }),
        holdingName: 'Bitcoin',
        holdingNameById,
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe('Transfer to USDⓈ-M Futures');
  });

  it('labels an incoming move from an untracked wallet by its product name', () => {
    expect(
      transactionRowDescription({
        transaction: row({
          holdingId: 'h-spot',
          amountMinorUnits: 100_000,
          untrackedCounterpart: 'wallet:PORTFOLIO_MARGIN',
        }),
        holdingName: 'Bitcoin',
        holdingNameById,
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe('Transfer from Portfolio Margin');
  });

  it('prefers the paired leg over an untracked wallet code', () => {
    expect(
      transactionRowDescription({
        transaction: row({
          holdingId: 'h-spot',
          amountMinorUnits: -100_000,
          exchangeCounterpartHoldingId: 'h-funding',
          untrackedCounterpart: 'wallet:MARGIN',
        }),
        holdingName: 'Bitcoin',
        holdingNameById,
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe('Transfer to Binance Funding');
  });

  it.each([['wallet:FOO'], ['asset:ETH'], ['']])(
    'falls back to the default label for the unknown code %p',
    (untrackedCounterpart) => {
      expect(
        transactionRowDescription({
          transaction: row({ untrackedCounterpart }),
          holdingName: 'Black card',
          holdingNameById,
          holdingCurrencyById,
          t: i18n.t,
        }),
      ).toBe('Black card expense');
    },
  );

  it('falls back to the holding-name default for an ordinary unlabelled row', () => {
    expect(
      transactionRowDescription({
        transaction: row({}),
        holdingName: 'Black card',
        holdingNameById,
        holdingCurrencyById,
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
        holdingCurrencyById,
        t: i18n.t,
      }),
    ).toBe(i18n.t('transactions.exchangeTo', { name: '' }));
  });
});
