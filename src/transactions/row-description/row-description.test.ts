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
  operation: null,
  ...overrides,
});

const labelOf = (
  overrides: Partial<Parameters<typeof transactionRowDescription>[0]['transaction']>,
): string =>
  transactionRowDescription({
    transaction: row(overrides),
    holdingName: 'Black card',
    holdingNameById,
    holdingCurrencyById,
    t: i18n.t,
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

  it.each([
    ['wallet:FOO'],
    ['asset:'],
    ['asset:ETH:BSC'],
    ['p2p:'],
    ['p2p::5'],
    ['foo:UAH:1'],
    [''],
  ])('falls back to the default label for the unknown code %p', (untrackedCounterpart) => {
    expect(labelOf({ untrackedCounterpart })).toBe('Black card expense');
  });

  it('keeps a stored description over a trading fee', () => {
    expect(
      labelOf({
        description: 'Fee',
        operation: 'trade-fee',
        exchangeCounterpartHoldingId: 'h-usd',
      }),
    ).toBe('Fee');
  });

  it('labels a trading fee that pairs with a counterpart holding', () => {
    expect(labelOf({ operation: 'trade-fee', exchangeCounterpartHoldingId: 'h-usd' })).toBe(
      'Trading fee',
    );
  });

  it('labels a trading fee of an asset with no counterpart holding', () => {
    expect(labelOf({ operation: 'trade-fee', untrackedCounterpart: 'asset:PEPE' })).toBe(
      'Trading fee',
    );
  });

  it.each([['trade'], ['convert'], ['dust']] as const)(
    'reads a %s leg with a counterpart holding as an exchange',
    (operation) => {
      expect(labelOf({ operation, exchangeCounterpartHoldingId: 'h-usd' })).toBe(
        'Exchange to Savings',
      );
    },
  );

  it('reads an outgoing asset leg with no counterpart holding as an exchange to the coin', () => {
    expect(labelOf({ amountMinorUnits: -100_000, untrackedCounterpart: 'asset:ETH' })).toBe(
      'Exchange to ETH',
    );
  });

  it('reads an incoming asset leg with no counterpart holding as an exchange from the coin', () => {
    expect(labelOf({ amountMinorUnits: 100_000, untrackedCounterpart: 'asset:ETH' })).toBe(
      'Exchange from ETH',
    );
  });

  it('prefers the counterpart holding over an asset code', () => {
    expect(
      labelOf({ exchangeCounterpartHoldingId: 'h-usd', untrackedCounterpart: 'asset:ETH' }),
    ).toBe('Exchange to Savings');
  });

  it.each([-415_000, 415_000])('labels a P2P code as a purchase for either sign (%d)', (amount) => {
    expect(labelOf({ amountMinorUnits: amount, untrackedCounterpart: 'p2p:UAH:4150.00' })).toBe(
      'P2P purchase (UAH)',
    );
  });

  it('labels a P2P code with a malformed total by its fiat alone', () => {
    expect(labelOf({ amountMinorUnits: 100, untrackedCounterpart: 'p2p:UAH:abc' })).toBe(
      'P2P purchase (UAH)',
    );
  });

  it.each([
    [260_000, 'card:UAH:2600.00', 'Card purchase (UAH)'],
    [-260_000, 'card:UAH:2600.00', 'Sale to card (UAH)'],
    [10_000, 'bank:EUR:100.00', 'Bank deposit (EUR)'],
    [-5_000, 'bank:EUR:50.00', 'Bank withdrawal (EUR)'],
  ])('labels the amount %d of %s as %s', (amountMinorUnits, untrackedCounterpart, label) => {
    expect(labelOf({ amountMinorUnits, untrackedCounterpart })).toBe(label);
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('uk');
    });

    it.each([
      [{ operation: 'trade-fee' as const }, 'Торгова комісія'],
      [
        { amountMinorUnits: 100, untrackedCounterpart: 'p2p:UAH:4150.00' },
        'Купівля через P2P (UAH)',
      ],
      [
        { amountMinorUnits: 100, untrackedCounterpart: 'card:UAH:2600.00' },
        'Купівля карткою (UAH)',
      ],
      [
        { amountMinorUnits: -100, untrackedCounterpart: 'card:UAH:2600.00' },
        'Продаж на картку (UAH)',
      ],
      [
        { amountMinorUnits: 100, untrackedCounterpart: 'bank:EUR:100.00' },
        'Поповнення з банку (EUR)',
      ],
      [
        { amountMinorUnits: -100, untrackedCounterpart: 'bank:EUR:50.00' },
        'Виведення в банк (EUR)',
      ],
    ])('reads the label of %o in Ukrainian', (overrides, label) => {
      expect(labelOf(overrides)).toBe(label);
    });
  });

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
