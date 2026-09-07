import '../i18n';
import { i18n } from '../i18n';

import { exchangeLegDescription } from './exchange-description';

describe('exchangeLegDescription', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('reads "to" for a negative (outgoing) leg', () => {
    expect(
      exchangeLegDescription({
        counterpartName: 'Savings',
        amountMinorUnits: -1_000_000,
        t: i18n.t,
      }),
    ).toBe('Exchange to Savings');
  });

  it('reads "from" for a positive (incoming) leg', () => {
    expect(
      exchangeLegDescription({
        counterpartName: 'Black card',
        amountMinorUnits: 24_000,
        t: i18n.t,
      }),
    ).toBe('Exchange from Black card');
  });

  it('resolves against the active language, not a persisted string', async () => {
    await i18n.changeLanguage('uk');

    expect(
      exchangeLegDescription({
        counterpartName: 'Ощадний',
        amountMinorUnits: -1_000_000,
        t: i18n.t,
      }),
    ).toBe(i18n.t('transactions.exchangeTo', { name: 'Ощадний' }));
    // The Ukrainian catalogue is a DIFFERENT sentence, not the English one
    // echoed back — proving the label is resolved, never persisted.
    expect(
      exchangeLegDescription({
        counterpartName: 'Ощадний',
        amountMinorUnits: -1_000_000,
        t: i18n.t,
      }),
    ).not.toBe('Exchange to Ощадний');
  });
});
