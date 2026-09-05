import { transactions } from './schema';

describe('transactions.source enum', () => {
  it('names every sync source alongside manual', () => {
    expect(transactions.source.enumValues).toEqual(['manual', 'monobank', 'btc_wallet', 'binance']);
  });
});
