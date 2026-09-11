import { canConvertToExchange, exchangeConvertDirection } from './exchange-convert';

describe('canConvertToExchange', () => {
  it('is eligible for a non-zero amount on a liquid (cash/card) holding', () => {
    expect(canConvertToExchange('cash', -500)).toBe(true);
    expect(canConvertToExchange('card', 500)).toBe(true);
  });

  it('is NOT eligible for a zero amount (no sign to pick a direction from)', () => {
    expect(canConvertToExchange('cash', 0)).toBe(false);
    expect(canConvertToExchange('card', 0)).toBe(false);
  });

  it('is NOT eligible on a non-liquid holding, regardless of amount', () => {
    expect(canConvertToExchange('term_deposit', -500)).toBe(false);
    expect(canConvertToExchange('bond', 500)).toBe(false);
    expect(canConvertToExchange('crypto_asset', -500)).toBe(false);
    expect(canConvertToExchange('jar', 500)).toBe(false);
  });
});

describe('exchangeConvertDirection', () => {
  it('records the DESTINATION leg for an existing expense (negative amount)', () => {
    expect(exchangeConvertDirection(-500)).toBe('record-destination');
  });

  it('records the SOURCE leg for an existing income (positive amount)', () => {
    expect(exchangeConvertDirection(500)).toBe('record-source');
  });

  it('returns null for a zero amount (no direction)', () => {
    expect(exchangeConvertDirection(0)).toBeNull();
  });
});
