import { transactions } from './schema';

describe('transactions.source enum', () => {
  // Guideline 5.6 remediation: PrivatBank, bunq, and Starling bank-CONNECT
  // were removed entirely — no user release ever shipped a transaction with
  // one of those sources, so no migration was needed to narrow this enum.
  it('names every sync source alongside manual', () => {
    expect(transactions.source.enumValues).toEqual([
      'manual',
      'monobank',
      'btc_wallet',
      'binance',
      'import',
    ]);
  });
});
