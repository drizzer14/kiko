import { currencyRateHistory, currencyRates, transactions } from './schema';

describe('the rate source enums', () => {
  it.each([
    ['currency_rates', currencyRates],
    ['currency_rate_history', currencyRateHistory],
  ])('names every rate source of %s', (_table, table) => {
    expect(table.source.enumValues).toEqual(['monobank', 'coingecko', 'nbu', 'binance']);
  });
});

describe('transactions.source enum', () => {
  // Guideline 2.3.1(a) remediation: PrivatBank, bunq, and Starling bank-CONNECT
  // were removed entirely — no user release ever shipped a transaction with
  // one of those sources, so no migration was needed to narrow this enum.
  it('names every sync source alongside manual', () => {
    expect(transactions.source.enumValues).toEqual([
      'manual',
      'monobank',
      'btc_wallet',
      'binance',
      'bybit',
      'import',
    ]);
  });
});
