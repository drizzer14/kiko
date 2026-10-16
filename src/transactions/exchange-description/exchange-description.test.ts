import { i18n } from '@kiko/i18n/init';

import { exchangeLegDescription, transferLegDescription } from './exchange-description';

describe('transferLegDescription', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('reads "Transfer to" for a negative leg', () => {
    expect(
      transferLegDescription({
        counterpartName: 'USDⓈ-M Futures',
        amountMinorUnits: -5_000,
        t: i18n.t,
      }),
    ).toBe('Transfer to USDⓈ-M Futures');
  });

  it('reads "Transfer from" for a positive leg', () => {
    expect(
      transferLegDescription({
        counterpartName: 'Margin',
        amountMinorUnits: 5_000,
        t: i18n.t,
      }),
    ).toBe('Transfer from Margin');
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('uk');
    });

    it('reads the sentences without quotes', () => {
      expect(
        transferLegDescription({ counterpartName: 'Margin', amountMinorUnits: -5_000, t: i18n.t }),
      ).toBe('Переказ на Margin');
      expect(
        transferLegDescription({ counterpartName: 'Margin', amountMinorUnits: 5_000, t: i18n.t }),
      ).toBe('Переказ з Margin');
    });
  });
});

describe('exchangeLegDescription', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('reads "to" for a negative (outgoing) leg', () => {
    expect(
      exchangeLegDescription({
        counterpartName: 'Savings',
        amountMinorUnits: -1_000_000,
        sameCurrency: false,
        t: i18n.t,
      }),
    ).toBe('Exchange to Savings');
  });

  it('reads "from" for a positive (incoming) leg', () => {
    expect(
      exchangeLegDescription({
        counterpartName: 'Black card',
        amountMinorUnits: 24_000,
        sameCurrency: false,
        t: i18n.t,
      }),
    ).toBe('Exchange from Black card');
  });

  it('reads "Transfer to" for a negative leg between holdings of one currency', () => {
    expect(
      exchangeLegDescription({
        counterpartName: 'Binance Funding',
        amountMinorUnits: -100_000,
        sameCurrency: true,
        t: i18n.t,
      }),
    ).toBe('Transfer to Binance Funding');
  });

  it('reads "Transfer from" for a positive leg between holdings of one currency', () => {
    expect(
      exchangeLegDescription({
        counterpartName: 'Binance Funding',
        amountMinorUnits: 100_000,
        sameCurrency: true,
        t: i18n.t,
      }),
    ).toBe('Transfer from Binance Funding');
  });

  it('resolves against the active language, not a persisted string', async () => {
    await i18n.changeLanguage('uk');

    expect(
      exchangeLegDescription({
        counterpartName: 'Ощадний',
        amountMinorUnits: -1_000_000,
        sameCurrency: false,
        t: i18n.t,
      }),
    ).toBe(i18n.t('transactions.exchangeTo', { name: 'Ощадний' }));
    // The Ukrainian catalogue is a DIFFERENT sentence, not the English one
    // echoed back — proving the label is resolved, never persisted.
    expect(
      exchangeLegDescription({
        counterpartName: 'Ощадний',
        amountMinorUnits: -1_000_000,
        sameCurrency: false,
        t: i18n.t,
      }),
    ).not.toBe('Exchange to Ощадний');
  });
});
