import { act, renderHook } from '@testing-library/react-native';

import { loanReasonKey, MAX_LOAN_TERM_MONTHS, useLoanFields } from './use-loan-fields';

const baseArgs = () => ({
  principal: '1000',
  startDate: 1_700_000_000_000,
  schedule: 'annuity' as const,
  annualRatePct: '12',
  termMonths: '12',
});

describe('loanReasonKey', () => {
  it('rejects a zero/blank principal regardless of schedule', () => {
    expect(loanReasonKey({ ...baseArgs(), principal: '' })).toBe(
      'forms.holding.loanPrincipalError',
    );
    expect(loanReasonKey({ ...baseArgs(), principal: '0' })).toBe(
      'forms.holding.loanPrincipalError',
    );
  });

  it('rejects an unpicked start date', () => {
    expect(loanReasonKey({ ...baseArgs(), startDate: null })).toBe(
      'forms.holding.loanStartDateError',
    );
  });

  it('is valid for a "none" (informal) loan with no rate or term entered', () => {
    expect(
      loanReasonKey({ ...baseArgs(), schedule: 'none', annualRatePct: '', termMonths: '' }),
    ).toBeNull();
  });

  it('requires an annual rate for an annuity/differentiated schedule', () => {
    expect(loanReasonKey({ ...baseArgs(), annualRatePct: '' })).toBe(
      'forms.holding.annualRateError',
    );
    expect(loanReasonKey({ ...baseArgs(), annualRatePct: '-1' })).toBe(
      'forms.holding.annualRateError',
    );
    expect(loanReasonKey({ ...baseArgs(), schedule: 'differentiated', annualRatePct: '' })).toBe(
      'forms.holding.annualRateError',
    );
  });

  it('accepts a zero annual rate (an interest-free structured loan)', () => {
    expect(loanReasonKey({ ...baseArgs(), annualRatePct: '0' })).toBeNull();
  });

  // T26 review, M1 (carried into T28): a degenerate term must not silently
  // pass — the schedule it produces would never reduce the balance to 0.
  it('rejects a zero, negative, or fractional term for a structured schedule', () => {
    expect(loanReasonKey({ ...baseArgs(), termMonths: '0' })).toBe('forms.holding.termMonthsError');
    expect(loanReasonKey({ ...baseArgs(), termMonths: '-3' })).toBe(
      'forms.holding.termMonthsError',
    );
    expect(loanReasonKey({ ...baseArgs(), termMonths: '6.5' })).toBe(
      'forms.holding.termMonthsError',
    );
  });

  it('is valid once every field is filled for a structured schedule', () => {
    expect(loanReasonKey(baseArgs())).toBeNull();
  });

  // Minor 10 (T28 review round 1): an uncapped term makes loanInstallments
  // build ~1e8 rows on every render (a valid positive integer, e.g.
  // "99999999", still passed the old check).
  it('rejects a term beyond MAX_LOAN_TERM_MONTHS', () => {
    expect(loanReasonKey({ ...baseArgs(), termMonths: String(MAX_LOAN_TERM_MONTHS + 1) })).toBe(
      'forms.holding.termMonthsError',
    );
  });

  it('accepts a term of exactly MAX_LOAN_TERM_MONTHS', () => {
    expect(loanReasonKey({ ...baseArgs(), termMonths: String(MAX_LOAN_TERM_MONTHS) })).toBeNull();
  });
});

describe('useLoanFields', () => {
  it('defaults to mortgage/annuity with every text field blank and no start date', async () => {
    const { result } = await renderHook(() => useLoanFields());

    expect(result.current.kind).toBe('mortgage');
    expect(result.current.schedule).toBe('annuity');
    expect(result.current.principal).toBe('');
    expect(result.current.startDate).toBeNull();
    expect(result.current.annualRatePct).toBe('');
    expect(result.current.termMonths).toBe('');
    expect(result.current.isValid).toBe(false);
    expect(result.current.reasonKey).toBe('forms.holding.loanPrincipalError');
  });

  it('reports isValid/reasonKey derived from the live field state', async () => {
    const { result } = await renderHook(() => useLoanFields());

    await act(async () => {
      result.current.setPrincipal('1000');
      result.current.setStartDate(1_700_000_000_000);
    });
    await act(async () => {
      result.current.setSchedule('none');
    });

    expect(result.current.isValid).toBe(true);
    expect(result.current.reasonKey).toBeNull();
  });

  it('seeds every field from a stored loan holding, converting the principal back to a major string', async () => {
    const { result } = await renderHook(() => useLoanFields());

    await act(async () => {
      result.current.seed({
        id: 'h1',
        currency: 'UAH',
        metadata: {
          kind: 'car_loan',
          principalMinorUnits: 500_000_00,
          startDate: 1_700_000_000_000,
          schedule: 'differentiated',
          annualRatePct: 9.5,
          termMonths: 24,
        },
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) `seed` only reads the fields above; a full HoldingRow literal would be pure noise here, mirroring the sibling seed-function tests in holding-form.screen.test.tsx.
      } as any);
    });

    expect(result.current.kind).toBe('car_loan');
    expect(result.current.principal).toBe('500 000');
    expect(result.current.startDate).toBe(1_700_000_000_000);
    expect(result.current.schedule).toBe('differentiated');
    expect(result.current.annualRatePct).toBe('9.5');
    expect(result.current.termMonths).toBe('24');
  });

  it('seeds a "none" loan with blank rate/term fields (both undefined in the stored metadata)', async () => {
    const { result } = await renderHook(() => useLoanFields());

    await act(async () => {
      result.current.seed({
        id: 'h1',
        currency: 'UAH',
        metadata: {
          kind: 'personal',
          principalMinorUnits: 10_000_00,
          startDate: 1_700_000_000_000,
          schedule: 'none',
        },
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) same as above.
      } as any);
    });

    expect(result.current.schedule).toBe('none');
    expect(result.current.annualRatePct).toBe('');
    expect(result.current.termMonths).toBe('');
  });

  it('leaves every field untouched for a holding with invalid/absent loan metadata', async () => {
    const { result } = await renderHook(() => useLoanFields());

    await act(async () => {
      result.current.seed({
        id: 'h1',
        currency: 'UAH',
        metadata: { not: 'a loan' },
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) same as above.
      } as any);
    });

    expect(result.current.kind).toBe('mortgage');
    expect(result.current.principal).toBe('');
    expect(result.current.startDate).toBeNull();
  });
});
