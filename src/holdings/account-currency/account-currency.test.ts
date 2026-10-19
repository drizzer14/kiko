import type { HoldingRow } from '@kiko/db';

import { accountCurrencyOf } from './account-currency';

type HoldingFields = Pick<HoldingRow, 'currency' | 'closedAt'>;

const open = (currency: HoldingRow['currency']): HoldingFields => ({ currency, closedAt: null });
const closed = (currency: HoldingRow['currency']): HoldingFields => ({
  currency,
  closedAt: 1_700_000_000_000,
});

describe('accountCurrencyOf', () => {
  it('returns the one currency the open holdings share', () => {
    expect(accountCurrencyOf([open('EUR'), open('EUR')], 'USD')).toBe('EUR');
  });

  it('returns the base currency for several currencies', () => {
    expect(accountCurrencyOf([open('UAH'), open('EUR')], 'USD')).toBe('USD');
  });

  it('returns the base currency for no holding', () => {
    expect(accountCurrencyOf([], 'USD')).toBe('USD');
  });

  it('returns the base currency when every holding is closed', () => {
    expect(accountCurrencyOf([closed('EUR'), closed('EUR')], 'USD')).toBe('USD');
  });

  it('ignores a closed holding beside an open one', () => {
    expect(accountCurrencyOf([open('EUR'), closed('USD')], 'UAH')).toBe('EUR');
    expect(accountCurrencyOf([closed('GBP'), open('EUR'), open('EUR')], 'UAH')).toBe('EUR');
  });

  it('counts a holding without closedAt as open', () => {
    expect(
      accountCurrencyOf(
        [{ currency: 'EUR' } as HoldingFields, { currency: 'USD' } as HoldingFields],
        'UAH',
      ),
    ).toBe('UAH');
    expect(accountCurrencyOf([{ currency: 'EUR' } as HoldingFields], 'UAH')).toBe('EUR');
  });

  it('returns a crypto currency', () => {
    expect(accountCurrencyOf([open('BTC')], 'UAH')).toBe('BTC');
  });

  it('returns the base when the base itself is the one open currency', () => {
    expect(accountCurrencyOf([open('USD')], 'UAH')).toBe('USD');
    expect(accountCurrencyOf([open('UAH'), open('UAH')], 'USD')).toBe('UAH');
  });
});
