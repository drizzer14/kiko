const mockUpdateLoan = jest.fn();
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { updateLoan: (...args: unknown[]) => mockUpdateLoan(...args) },
}));

import type { HoldingRow } from '@kiko/db/schema';
import { MAX_TERM_MONTHS } from '@kiko/holdings/term-limits';
import { act, renderHook } from '@testing-library/react-native';
import type { LoanMeta } from '@kiko/holdings/holding-metadata';

import {
  loanEditInvalidatesAutoLinks,
  loanFieldErrors,
  loanReasonKey,
  useLoanFields,
} from './use-loan-fields';

const renderLoanFields = () => renderHook(() => useLoanFields({ currency: 'UAH' }));

// A minimal EDIT-mode `editingHolding`, so `saveEdit` reads `oldMeta` off it
// rather than seeding through `seed` first — the two are independent state
// (`saveEdit` reads `context.editingHolding`, `seed` only sets the LIVE
// field state), so a wiring test only needs this, never a `seed` call.
const editingHoldingWith = (meta: LoanMeta): HoldingRow =>
  ({
    id: 'h-1',
    currency: 'UAH',
    metadata: meta,
    // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) `saveEdit` only reads `metadata` off `editingHolding` (via `asLoanMeta`); a full HoldingRow literal would be pure noise here, mirroring this file's own `seed` fixtures above.
  }) as any;

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

  // A degenerate term must not silently
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

  // An uncapped term makes loanInstallments
  // build ~1e8 rows on every render (a valid positive integer, e.g.
  // "99999999", still passed the old check).
  it('names the maximum once a term exceeds the shared MAX_TERM_MONTHS cap', () => {
    expect(loanReasonKey({ ...baseArgs(), termMonths: String(MAX_TERM_MONTHS + 1) })).toBe(
      'forms.holding.termMonthsMaxError',
    );
  });

  it('accepts a term of exactly MAX_TERM_MONTHS', () => {
    expect(loanReasonKey({ ...baseArgs(), termMonths: String(MAX_TERM_MONTHS) })).toBeNull();
  });
});

describe('loanFieldErrors', () => {
  it('reports the principal and start-date errors independently, both at once when both are blank', () => {
    const errors = loanFieldErrors({ ...baseArgs(), principal: '', startDate: null });

    expect(errors.principalError).toBe('forms.holding.loanPrincipalError');
    expect(errors.startDateError).toBe('forms.holding.loanStartDateError');
  });

  it('clears the principal error alone once principal is fixed, leaving the start-date error untouched', () => {
    const errors = loanFieldErrors({ ...baseArgs(), principal: '1000', startDate: null });

    expect(errors.principalError).toBeNull();
    expect(errors.startDateError).toBe('forms.holding.loanStartDateError');
  });

  it('reports no rate/term error for a "none" schedule regardless of principal/start-date state', () => {
    const errors = loanFieldErrors({
      ...baseArgs(),
      principal: '',
      startDate: null,
      schedule: 'none',
      annualRatePct: '',
      termMonths: '',
    });

    expect(errors.annualRateError).toBeNull();
    expect(errors.termMonthsError).toBeNull();
  });

  it('reports every field valid once every field is filled for a structured schedule', () => {
    const errors = loanFieldErrors(baseArgs());

    expect(errors).toEqual({
      principalError: null,
      startDateError: null,
      annualRateError: null,
      termMonthsError: null,
    });
  });
});

describe('useLoanFields', () => {
  it('defaults to mortgage/annuity with every text field blank and no start date', async () => {
    const { result } = await renderLoanFields();

    expect(result.current.kind).toBe('mortgage');
    expect(result.current.schedule).toBe('annuity');
    expect(result.current.principal).toBe('');
    expect(result.current.startDate).toBeNull();
    expect(result.current.annualRatePct).toBe('');
    expect(result.current.termMonths).toBe('');
    expect(result.current.paymentHoldingId).toBeNull();
    expect(result.current.lenderName).toBe('');
    expect(result.current.lenderIban).toBe('');
    expect(result.current.isValid).toBe(false);
    expect(result.current.reasonKey).toBe('forms.holding.loanPrincipalError');
    expect(result.current.fieldErrors.principalError).toBe('forms.holding.loanPrincipalError');
    expect(result.current.fieldErrors.startDateError).toBe('forms.holding.loanStartDateError');
  });

  it('reports isValid/reasonKey derived from the live field state', async () => {
    const { result } = await renderLoanFields();

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
    const { result } = await renderLoanFields();

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

  it('seeds paymentHoldingId/lenderName/lenderIban from stored metadata, defaulting to null/blank when absent', async () => {
    const { result } = await renderLoanFields();

    await act(async () => {
      result.current.seed({
        id: 'h1',
        currency: 'UAH',
        metadata: {
          kind: 'mortgage',
          principalMinorUnits: 500_000_00,
          startDate: 1_700_000_000_000,
          schedule: 'annuity',
          annualRatePct: 9.5,
          termMonths: 24,
          paymentHoldingId: 'h-payer',
          lenderName: 'PrivatBank',
          lenderIban: 'UA123456789012345678901234567',
        },
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) same as above.
      } as any);
    });

    expect(result.current.paymentHoldingId).toBe('h-payer');
    expect(result.current.lenderName).toBe('PrivatBank');
    expect(result.current.lenderIban).toBe('UA123456789012345678901234567');

    await act(async () => {
      result.current.seed({
        id: 'h2',
        currency: 'UAH',
        metadata: {
          kind: 'mortgage',
          principalMinorUnits: 500_000_00,
          startDate: 1_700_000_000_000,
          schedule: 'annuity',
          annualRatePct: 9.5,
          termMonths: 24,
        },
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) same as above.
      } as any);
    });

    expect(result.current.paymentHoldingId).toBeNull();
    expect(result.current.lenderName).toBe('');
    expect(result.current.lenderIban).toBe('');
  });

  // Item 5: the CREATE payload normalizes lenderIban (strip whitespace,
  // uppercase) so a cosmetic difference from what a bank feed's own
  // counterIban carries never false-negatives the matcher's rule 3.
  it('normalizes lenderIban (strip whitespace, uppercase) in the create payload, leaving the typed field display untouched', async () => {
    const { result } = await renderLoanFields();

    await act(async () => {
      result.current.setPrincipal('1000');
      result.current.setStartDate(1_700_000_000_000);
      result.current.setAnnualRatePct('12');
      result.current.setTermMonths('12');
      result.current.setLenderIban(' ua12 3456 7890 ');
    });

    expect(result.current.lenderIban).toBe(' ua12 3456 7890 ');
    expect(result.current.createPayload().metadata).toMatchObject({
      lenderIban: 'UA1234567890',
    });
  });

  it('seeds a "none" loan with blank rate/term fields (both undefined in the stored metadata)', async () => {
    const { result } = await renderLoanFields();

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
    const { result } = await renderLoanFields();

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

  describe('scrollTargets', () => {
    it('orders scrollTargets principal, start date, annual rate, term months, each on its own ref', async () => {
      const { result } = await renderLoanFields();
      const { refs } = result.current;

      expect(result.current.scrollTargets.map((target) => target.ref)).toEqual([
        refs.principalFieldRef,
        refs.startDateFieldRef,
        refs.annualRateFieldRef,
        refs.termMonthsFieldRef,
      ]);
    });

    it('blocks on the principal field first when every field is blank', async () => {
      const { result } = await renderLoanFields();

      const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

      expect(firstInvalid?.ref).toBe(result.current.refs.principalFieldRef);
    });

    it('blocks on the start-date field once principal is fixed', async () => {
      const { result } = await renderLoanFields();

      await act(async () => {
        result.current.setPrincipal('1000');
      });

      const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

      expect(firstInvalid?.ref).toBe(result.current.refs.startDateFieldRef);
    });

    it('blocks on the annual-rate field once principal and start date are fixed, for a structured schedule', async () => {
      const { result } = await renderLoanFields();

      await act(async () => {
        result.current.setPrincipal('1000');
        result.current.setStartDate(1_700_000_000_000);
      });

      const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

      expect(firstInvalid?.ref).toBe(result.current.refs.annualRateFieldRef);
    });

    it('blocks on the term-months field once every earlier field is fixed', async () => {
      const { result } = await renderLoanFields();

      await act(async () => {
        result.current.setPrincipal('1000');
        result.current.setStartDate(1_700_000_000_000);
        result.current.setAnnualRatePct('12');
      });

      const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

      expect(firstInvalid?.ref).toBe(result.current.refs.termMonthsFieldRef);
    });

    it('finds no invalid target for a fully valid "none" schedule (rate/term never block)', async () => {
      const { result } = await renderLoanFields();

      await act(async () => {
        result.current.setPrincipal('1000');
        result.current.setStartDate(1_700_000_000_000);
      });
      await act(async () => {
        result.current.setSchedule('none');
      });

      expect(result.current.scrollTargets.find((target) => target.invalid)).toBeUndefined();
    });
  });
});

const baseMeta = (overrides: Partial<LoanMeta> = {}): LoanMeta => ({
  kind: 'mortgage',
  principalMinorUnits: 1_200_000,
  startDate: 1_700_000_000_000,
  schedule: 'annuity',
  annualRatePct: 12,
  termMonths: 12,
  ...overrides,
});

describe('loanEditInvalidatesAutoLinks', () => {
  it('is false when nothing rules 1/2/3 depend on changed', () => {
    const oldMeta = baseMeta({ kind: 'mortgage' });
    const newMeta = baseMeta({ kind: 'car_loan' });

    expect(loanEditInvalidatesAutoLinks(oldMeta, newMeta)).toBe(false);
  });

  it('is true when the principal changed', () => {
    expect(
      loanEditInvalidatesAutoLinks(baseMeta(), baseMeta({ principalMinorUnits: 2_000_00 })),
    ).toBe(true);
  });

  it('is true when the schedule changed', () => {
    expect(loanEditInvalidatesAutoLinks(baseMeta(), baseMeta({ schedule: 'differentiated' }))).toBe(
      true,
    );
  });

  it('is true when the annual rate changed', () => {
    expect(loanEditInvalidatesAutoLinks(baseMeta(), baseMeta({ annualRatePct: 18 }))).toBe(true);
  });

  it('is true when the term changed', () => {
    expect(loanEditInvalidatesAutoLinks(baseMeta(), baseMeta({ termMonths: 24 }))).toBe(true);
  });

  it('is true when the start date moved', () => {
    expect(
      loanEditInvalidatesAutoLinks(baseMeta(), baseMeta({ startDate: 1_702_000_000_000 })),
    ).toBe(true);
  });

  it('is true when paymentHoldingId changed', () => {
    expect(
      loanEditInvalidatesAutoLinks(baseMeta(), baseMeta({ paymentHoldingId: 'payer-2' })),
    ).toBe(true);
  });

  it('is true when the lenderIban changed', () => {
    expect(
      loanEditInvalidatesAutoLinks(
        baseMeta({ lenderIban: 'UA213223130000260072355660001' }),
        baseMeta({ lenderIban: 'UA999999130000260072355660002' }),
      ),
    ).toBe(true);
  });

  it('is false when the lenderIban only differs by whitespace/case', () => {
    expect(
      loanEditInvalidatesAutoLinks(
        baseMeta({ lenderIban: 'UA213223130000260072355660001' }),
        baseMeta({ lenderIban: 'ua21 3223 1300 0026 0072 3556 6000 1' }),
      ),
    ).toBe(false);
  });

  it('is true when the lenderName changed', () => {
    expect(
      loanEditInvalidatesAutoLinks(
        baseMeta({ lenderName: 'PrivatBank' }),
        baseMeta({ lenderName: 'Oschadbank' }),
      ),
    ).toBe(true);
  });
});

describe('useLoanFields — saveEdit clearing auto links (item 1)', () => {
  beforeEach(() => {
    mockUpdateLoan.mockClear();
    mockUpdateLoan.mockResolvedValue(undefined);
  });

  it('asks updateLoan to clear auto links when the principal changed', async () => {
    const { result } = await renderLoanFields();

    await act(async () => {
      result.current.seed(editingHoldingWith(baseMeta()));
    });
    await act(async () => {
      result.current.setPrincipal('2000');
    });
    await act(async () => {
      await result.current.saveEdit({
        holdingId: 'h-1',
        name: 'Car loan',
        color: null,
        currency: 'UAH',
        isSynced: false,
        editingHolding: editingHoldingWith(baseMeta()),
        book: new Map(),
      });
    });

    expect(mockUpdateLoan).toHaveBeenCalledWith('h-1', expect.anything(), expect.anything(), true);
  });

  it('asks updateLoan to clear auto links when only the lender name changed', async () => {
    const { result } = await renderLoanFields();

    await act(async () => {
      result.current.seed(editingHoldingWith(baseMeta()));
    });
    await act(async () => {
      result.current.setLenderName('Oschadbank');
    });
    await act(async () => {
      await result.current.saveEdit({
        holdingId: 'h-1',
        name: 'Car loan',
        color: null,
        currency: 'UAH',
        isSynced: false,
        editingHolding: editingHoldingWith(baseMeta()),
        book: new Map(),
      });
    });

    expect(mockUpdateLoan).toHaveBeenCalledWith('h-1', expect.anything(), expect.anything(), true);
  });

  it('never asks updateLoan to clear auto links when only the holding name/color changed', async () => {
    const { result } = await renderLoanFields();

    await act(async () => {
      result.current.seed(editingHoldingWith(baseMeta()));
    });
    await act(async () => {
      await result.current.saveEdit({
        holdingId: 'h-1',
        name: 'Renamed car loan',
        color: '#FF0000',
        currency: 'UAH',
        isSynced: false,
        editingHolding: editingHoldingWith(baseMeta()),
        book: new Map(),
      });
    });

    expect(mockUpdateLoan).toHaveBeenCalledWith('h-1', expect.anything(), expect.anything(), false);
  });

  it('never asks updateLoan to clear auto links for a fresh holding (no prior metadata)', async () => {
    const { result } = await renderLoanFields();

    await act(async () => {
      result.current.setPrincipal('1000');
      result.current.setStartDate(1_700_000_000_000);
    });
    await act(async () => {
      await result.current.saveEdit({
        holdingId: 'h-1',
        name: 'Car loan',
        color: null,
        currency: 'UAH',
        isSynced: false,
        editingHolding: undefined,
        book: new Map(),
      });
    });

    expect(mockUpdateLoan).toHaveBeenCalledWith('h-1', expect.anything(), expect.anything(), false);
  });
});
