import { i18n } from '@kiko/i18n/init';

import { ruleDescriptionOf } from './rule-description';

const holdingNameById = new Map([['h-usd', 'Savings']]);
const holdingCurrencyById = new Map([
  ['h-card', 'UAH'],
  ['h-usd', 'USD'],
]);

const ruleDescription = (
  overrides: Partial<Parameters<typeof ruleDescriptionOf>[0]['transaction']>,
): string =>
  ruleDescriptionOf({
    transaction: {
      holdingId: 'h-card',
      description: '',
      amountMinorUnits: -1_000_000,
      exchangeCounterpartHoldingId: null,
      untrackedCounterpart: null,
      operation: null,
      ...overrides,
    },
    holdingName: 'Black card',
    holdingNameById,
    holdingCurrencyById,
    t: i18n.t,
  });

describe('ruleDescriptionOf', () => {
  it('reads a stored description as it is', () => {
    expect(ruleDescription({ description: 'Silpo' })).toBe('Silpo');
  });

  it('reads a blank description as the default label the lists show, in English', () => {
    expect(ruleDescription({})).toBe('Black card expense');
    expect(ruleDescription({ amountMinorUnits: 1_000 })).toBe('Black card income');
  });

  it('treats a missing description as blank', () => {
    expect(ruleDescription({ description: undefined })).toBe('Black card expense');
    expect(ruleDescription({ description: null })).toBe('Black card expense');
  });

  it('reads a blank exchange leg as its exchange label', () => {
    expect(ruleDescription({ exchangeCounterpartHoldingId: 'h-usd' })).toBe('Exchange to Savings');
  });

  it('reads a blank trading fee as its fee label', () => {
    expect(ruleDescription({ operation: 'trade-fee' })).toBe('Trading fee');
  });

  it('keeps a description of spaces as it is, because the list shows it as it is', () => {
    expect(ruleDescription({ description: '   ' })).toBe('   ');
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('uk');
    });

    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('reads a blank description as the default label in the language the app runs in now', () => {
      expect(ruleDescription({})).toBe('Витрата: Black card');
      expect(ruleDescription({ amountMinorUnits: 1_000 })).toBe('Надходження: Black card');
    });
  });
});
