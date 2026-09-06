import {
  exchangeReceivePath,
  isExchangeCreateDestinationType,
  isExchangeCreateSourceType,
  isExchangeDestinationType,
  isExchangeSourceType,
} from './exchange-destination';

describe('exchangeReceivePath', () => {
  it('maps cash, card, and crypto_asset destinations to a plain transaction', () => {
    expect(exchangeReceivePath('cash')).toBe('plain');
    expect(exchangeReceivePath('card')).toBe('plain');
    expect(exchangeReceivePath('crypto_asset')).toBe('plain');
  });

  it('maps a term_deposit destination to a contribution', () => {
    expect(exchangeReceivePath('term_deposit')).toBe('contribution');
  });

  it('excludes bond and jar destinations', () => {
    expect(exchangeReceivePath('bond')).toBe('excluded');
    expect(exchangeReceivePath('jar')).toBe('excluded');
  });
});

describe('isExchangeDestinationType', () => {
  it('accepts every non-excluded type and rejects bond/jar', () => {
    expect(isExchangeDestinationType('cash')).toBe(true);
    expect(isExchangeDestinationType('term_deposit')).toBe(true);
    expect(isExchangeDestinationType('bond')).toBe(false);
    expect(isExchangeDestinationType('jar')).toBe(false);
  });
});

describe('isExchangeSourceType', () => {
  it('accepts only cash and card as liquid sources', () => {
    expect(isExchangeSourceType('cash')).toBe(true);
    expect(isExchangeSourceType('card')).toBe(true);
    expect(isExchangeSourceType('term_deposit')).toBe(false);
    expect(isExchangeSourceType('bond')).toBe(false);
    expect(isExchangeSourceType('crypto_asset')).toBe(false);
    expect(isExchangeSourceType('jar')).toBe(false);
  });
});

describe('isExchangeCreateSourceType', () => {
  it('accepts only cash on create (card is excluded, unlike convert)', () => {
    expect(isExchangeCreateSourceType('cash')).toBe(true);
    expect(isExchangeCreateSourceType('card')).toBe(false);
    expect(isExchangeCreateSourceType('term_deposit')).toBe(false);
    expect(isExchangeCreateSourceType('bond')).toBe(false);
    expect(isExchangeCreateSourceType('crypto_asset')).toBe(false);
    expect(isExchangeCreateSourceType('jar')).toBe(false);
  });
});

describe('isExchangeCreateDestinationType', () => {
  it('accepts only cash on create (card/crypto/term_deposit excluded, unlike convert)', () => {
    expect(isExchangeCreateDestinationType('cash')).toBe(true);
    expect(isExchangeCreateDestinationType('card')).toBe(false);
    expect(isExchangeCreateDestinationType('crypto_asset')).toBe(false);
    expect(isExchangeCreateDestinationType('term_deposit')).toBe(false);
    expect(isExchangeCreateDestinationType('bond')).toBe(false);
    expect(isExchangeCreateDestinationType('jar')).toBe(false);
  });
});
