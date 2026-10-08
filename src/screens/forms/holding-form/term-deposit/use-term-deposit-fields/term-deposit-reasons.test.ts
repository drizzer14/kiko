import { MAX_TERM_MONTHS } from '@kiko/holdings/term-limits';

import {
  termDepositFieldErrors,
  termDepositReasonKey,
  type Contribution,
} from './term-deposit-reasons';

const row = (overrides: Partial<Contribution> = {}): Contribution => ({
  id: 0,
  amount: '1000',
  date: 1_700_000_000_000,
  saved: false,
  ...overrides,
});

const baseParams = () => ({
  contributions: [row()],
  annualRate: '12',
  term: '12',
  termUnit: 'months' as const,
  currency: 'UAH' as const,
});

describe('termDepositFieldErrors — contributions', () => {
  it('requires at least one contribution when every row is blank', () => {
    const errors = termDepositFieldErrors({
      ...baseParams(),
      contributions: [row({ amount: '', date: null })],
    });

    expect(errors.contributionsError).toBe('forms.holding.contributionsRequiredError');
  });

  it('requires at least one contribution for a row with an amount but no date', () => {
    const errors = termDepositFieldErrors({
      ...baseParams(),
      contributions: [row({ date: null })],
    });

    expect(errors.contributionsError).toBe('forms.holding.contributionsRequiredError');
  });

  it('flags an incomplete row once at least one other row already parses', () => {
    const errors = termDepositFieldErrors({
      ...baseParams(),
      contributions: [row(), row({ id: 1, amount: '500', date: null })],
    });

    expect(errors.contributionsError).toBe('forms.holding.contributionIncompleteError');
  });

  it('passes once every row is either fully filled or removed', () => {
    const errors = termDepositFieldErrors({
      ...baseParams(),
      contributions: [row(), row({ id: 1, amount: '500', date: 1_700_000_001_000 })],
    });

    expect(errors.contributionsError).toBeNull();
  });
});

describe('termDepositFieldErrors — annual rate', () => {
  it('rejects a blank rate', () => {
    expect(termDepositFieldErrors({ ...baseParams(), annualRate: '' }).annualRateError).toBe(
      'forms.holding.annualRateError',
    );
  });

  it('rejects a negative rate', () => {
    expect(termDepositFieldErrors({ ...baseParams(), annualRate: '-1' }).annualRateError).toBe(
      'forms.holding.annualRateError',
    );
  });

  it('accepts a zero rate (a non-interest-bearing deposit)', () => {
    expect(termDepositFieldErrors({ ...baseParams(), annualRate: '0' }).annualRateError).toBeNull();
  });

  it('accepts a positive rate', () => {
    expect(
      termDepositFieldErrors({ ...baseParams(), annualRate: '12' }).annualRateError,
    ).toBeNull();
  });
});

describe('termDepositFieldErrors — term months', () => {
  it('rejects a blank term', () => {
    expect(termDepositFieldErrors({ ...baseParams(), term: '' }).termError).toBe(
      'forms.holding.termMonthsError',
    );
  });

  it('rejects a zero term', () => {
    expect(termDepositFieldErrors({ ...baseParams(), term: '0' }).termError).toBe(
      'forms.holding.termMonthsError',
    );
  });

  it('rejects a fractional term', () => {
    expect(termDepositFieldErrors({ ...baseParams(), term: '6.5' }).termError).toBe(
      'forms.holding.termMonthsError',
    );
  });

  it('accepts a whole positive term', () => {
    expect(termDepositFieldErrors({ ...baseParams(), term: '12' }).termError).toBeNull();
  });

  it('names the maximum once a term exceeds the shared MAX_TERM_MONTHS cap', () => {
    expect(
      termDepositFieldErrors({ ...baseParams(), term: String(MAX_TERM_MONTHS + 1) }).termError,
    ).toBe('forms.holding.termMonthsMaxError');
  });

  it('accepts a term of exactly MAX_TERM_MONTHS', () => {
    expect(
      termDepositFieldErrors({ ...baseParams(), term: String(MAX_TERM_MONTHS) }).termError,
    ).toBeNull();
  });
});

describe('termDepositFieldErrors — term in years', () => {
  it('names years when a years term is not a whole number', () => {
    expect(
      termDepositFieldErrors({ ...baseParams(), term: '1.5', termUnit: 'years' }).termError,
    ).toBe('forms.holding.termYearsError');
  });

  it('names the years maximum once a years term exceeds the cap', () => {
    expect(
      termDepositFieldErrors({ ...baseParams(), term: '51', termUnit: 'years' }).termError,
    ).toBe('forms.holding.termYearsMaxError');
  });
});

describe('termDepositFieldErrors — term months, just below the cap', () => {
  it('accepts a term one below the shared MAX_TERM_MONTHS cap', () => {
    expect(
      termDepositFieldErrors({ ...baseParams(), term: String(MAX_TERM_MONTHS - 1) }).termError,
    ).toBeNull();
  });
});

describe('termDepositReasonKey', () => {
  it('returns null once every field passes', () => {
    expect(termDepositReasonKey(baseParams())).toBeNull();
  });

  it('prioritizes the contributions reason over annual rate and term months', () => {
    expect(
      termDepositReasonKey({
        ...baseParams(),
        contributions: [row({ amount: '', date: null })],
        annualRate: '',
        term: '',
      }),
    ).toBe('forms.holding.contributionsRequiredError');
  });

  it('prioritizes the annual-rate reason over term months once contributions pass', () => {
    expect(termDepositReasonKey({ ...baseParams(), annualRate: '', term: '' })).toBe(
      'forms.holding.annualRateError',
    );
  });
});
