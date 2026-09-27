import { propertyFieldErrors, propertyReasonKey } from './property-reasons';

const whole = { numerator: 1, denominator: 1 };
const valid = { isEdit: false, cost: '5000', ownershipApplies: true, ownership: whole };

describe('propertyFieldErrors — cost', () => {
  it('rejects a blank cost on create', () => {
    expect(propertyFieldErrors({ ...valid, cost: '' }).costError).toBe(
      'forms.holding.propertyCostError',
    );
  });

  it('rejects a zero cost on create', () => {
    expect(propertyFieldErrors({ ...valid, cost: '0' }).costError).toBe(
      'forms.holding.propertyCostError',
    );
  });

  it('accepts a positive cost on create', () => {
    expect(propertyFieldErrors(valid).costError).toBeNull();
  });

  it('accepts a blank cost on edit (the field does not apply there)', () => {
    expect(propertyFieldErrors({ ...valid, isEdit: true, cost: '' }).costError).toBeNull();
  });
});

describe('propertyFieldErrors — ownership', () => {
  it('rejects a share that did not parse, on create and on edit', () => {
    expect(propertyFieldErrors({ ...valid, ownership: null }).ownershipError).toBe(
      'forms.holding.ownershipError',
    );
    expect(propertyFieldErrors({ ...valid, isEdit: true, ownership: null }).ownershipError).toBe(
      'forms.holding.ownershipError',
    );
  });

  it('accepts a parsed share', () => {
    expect(propertyFieldErrors(valid).ownershipError).toBeNull();
  });

  it('never blocks on a share the category does not take', () => {
    expect(
      propertyFieldErrors({ ...valid, ownershipApplies: false, ownership: null }).ownershipError,
    ).toBeNull();
  });
});

describe('propertyReasonKey', () => {
  it('returns null once every field passes', () => {
    expect(propertyReasonKey(valid)).toBeNull();
  });

  it('returns the cost reason once it fails', () => {
    expect(propertyReasonKey({ ...valid, cost: '' })).toBe('forms.holding.propertyCostError');
  });

  it('returns the ownership reason once it fails', () => {
    expect(propertyReasonKey({ ...valid, ownership: null })).toBe('forms.holding.ownershipError');
  });

  it('never blocks on edit with a valid share', () => {
    expect(propertyReasonKey({ ...valid, isEdit: true, cost: '' })).toBeNull();
  });
});
