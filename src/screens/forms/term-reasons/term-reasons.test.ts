import { MAX_TERM_MONTHS } from '@kiko/holdings/term-limits';

import {
  termMaxFor,
  termReasonKey,
  termInputFromMonths,
  termMonthsFromInput,
} from './term-reasons';

describe('termMonthsFromInput', () => {
  it('reads a months entry as that many months', () => {
    expect(termMonthsFromInput('18', 'months')).toBe(18);
  });

  it('reads a years entry as twelve months per year', () => {
    expect(termMonthsFromInput('2', 'years')).toBe(24);
  });

  it('reads nothing from a blank, zero, negative, or fractional entry', () => {
    expect(termMonthsFromInput('', 'months')).toBeNull();
    expect(termMonthsFromInput('0', 'years')).toBeNull();
    expect(termMonthsFromInput('-3', 'months')).toBeNull();
    expect(termMonthsFromInput('1.5', 'years')).toBeNull();
  });
});

describe('termReasonKey', () => {
  it('accepts a whole number up to the cap in either unit', () => {
    expect(termReasonKey(String(MAX_TERM_MONTHS), 'months')).toBeNull();
    expect(termReasonKey(String(MAX_TERM_MONTHS / 12), 'years')).toBeNull();
  });

  it('names the unit when the entry is not a whole number above 0', () => {
    expect(termReasonKey('6.5', 'months')).toBe('forms.holding.termMonthsError');
    expect(termReasonKey('1.5', 'years')).toBe('forms.holding.termYearsError');
    expect(termReasonKey('', 'years')).toBe('forms.holding.termYearsError');
  });

  it('names the unit maximum when the entry is above the cap', () => {
    expect(termReasonKey(String(MAX_TERM_MONTHS + 1), 'months')).toBe(
      'forms.holding.termMonthsMaxError',
    );
    expect(termReasonKey('51', 'years')).toBe('forms.holding.termYearsMaxError');
  });
});

describe('termMaxFor', () => {
  it('caps months at the shared maximum and years at the same span', () => {
    expect(termMaxFor('months')).toBe(MAX_TERM_MONTHS);
    expect(termMaxFor('years')).toBe(50);
  });
});

describe('termInputFromMonths', () => {
  it('shows a whole number of years in years', () => {
    expect(termInputFromMonths(36)).toEqual({ value: '3', unit: 'years' });
  });

  it('shows any other term in months', () => {
    expect(termInputFromMonths(18)).toEqual({ value: '18', unit: 'months' });
  });
});
