import { metalFieldErrors, metalReasonKey } from './metal-reasons';

const baseParams = () => ({
  isEdit: false,
  purity: '0.9999',
  quantity: '31.1',
  cost: '80000',
});

describe('metalFieldErrors — purity', () => {
  it('rejects a garbled purity normalizeDecimal cannot parse', () => {
    expect(metalFieldErrors({ ...baseParams(), purity: '999,9' }).purityError).toBe(
      'forms.holding.purityError',
    );
  });

  it('rejects a purity of 0', () => {
    expect(metalFieldErrors({ ...baseParams(), purity: '0' }).purityError).toBe(
      'forms.holding.purityError',
    );
  });

  it('rejects a purity greater than 1', () => {
    expect(metalFieldErrors({ ...baseParams(), purity: '1.5' }).purityError).toBe(
      'forms.holding.purityError',
    );
  });

  it('accepts a purity of exactly 1', () => {
    expect(metalFieldErrors({ ...baseParams(), purity: '1' }).purityError).toBeNull();
  });

  it('accepts the standard fineness default', () => {
    expect(metalFieldErrors({ ...baseParams(), purity: '0.9999' }).purityError).toBeNull();
  });

  it('applies in BOTH create and edit mode', () => {
    expect(metalFieldErrors({ ...baseParams(), isEdit: true, purity: '999,9' }).purityError).toBe(
      'forms.holding.purityError',
    );
  });
});

describe('metalFieldErrors — quantity', () => {
  it('rejects a blank quantity on create', () => {
    expect(metalFieldErrors({ ...baseParams(), quantity: '' }).quantityError).toBe(
      'forms.holding.quantityError',
    );
  });

  it('rejects a zero quantity on create', () => {
    expect(metalFieldErrors({ ...baseParams(), quantity: '0' }).quantityError).toBe(
      'forms.holding.quantityError',
    );
  });

  it('accepts a positive quantity on create', () => {
    expect(metalFieldErrors({ ...baseParams(), quantity: '31.1' }).quantityError).toBeNull();
  });

  it('never blocks on edit (create-only field)', () => {
    expect(
      metalFieldErrors({ ...baseParams(), isEdit: true, quantity: '' }).quantityError,
    ).toBeNull();
  });
});

describe('metalFieldErrors — cost', () => {
  it('rejects a blank cost on create', () => {
    expect(metalFieldErrors({ ...baseParams(), cost: '' }).costError).toBe(
      'forms.lot.totalCostError',
    );
  });

  it('accepts a positive cost on create', () => {
    expect(metalFieldErrors({ ...baseParams(), cost: '80000' }).costError).toBeNull();
  });

  it('never blocks on edit (create-only field)', () => {
    expect(metalFieldErrors({ ...baseParams(), isEdit: true, cost: '' }).costError).toBeNull();
  });
});

describe('metalReasonKey', () => {
  it('returns null once every field passes', () => {
    expect(metalReasonKey(baseParams())).toBeNull();
  });

  it('prioritizes the purity reason over quantity and cost', () => {
    expect(metalReasonKey({ ...baseParams(), purity: '1.5', quantity: '', cost: '' })).toBe(
      'forms.holding.purityError',
    );
  });

  it('prioritizes the quantity reason over cost once purity passes', () => {
    expect(metalReasonKey({ ...baseParams(), quantity: '', cost: '' })).toBe(
      'forms.holding.quantityError',
    );
  });
});
