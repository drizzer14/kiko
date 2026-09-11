import { normalizeTransactionName } from './normalize-name';

describe('normalizeTransactionName', () => {
  it('lowercases and trims edge whitespace', () => {
    expect(normalizeTransactionName('  ATB Market  ')).toBe('atb market');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeTransactionName('ATB   Market\tShop')).toBe('atb market shop');
  });

  it('lowercases non-ASCII (Cyrillic) that SQLite lower() would not', () => {
    expect(normalizeTransactionName('АТБ')).toBe(normalizeTransactionName('атб'));
  });

  it('applies NFC unicode normalization so composed/decomposed forms match', () => {
    // 'café' composed vs 'cafe' + combining acute accent
    expect(normalizeTransactionName('café')).toBe(normalizeTransactionName('café'));
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeTransactionName('   \t  ')).toBe('');
  });

  it('returns an empty string for an empty input', () => {
    expect(normalizeTransactionName('')).toBe('');
  });
});
