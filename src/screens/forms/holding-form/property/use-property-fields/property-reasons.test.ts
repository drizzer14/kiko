import { propertyFieldErrors, propertyReasonKey } from './property-reasons';

describe('propertyFieldErrors — cost', () => {
  it('rejects a blank cost on create', () => {
    expect(propertyFieldErrors({ isEdit: false, cost: '' }).costError).toBe(
      'forms.holding.propertyCostError',
    );
  });

  it('rejects a zero cost on create', () => {
    expect(propertyFieldErrors({ isEdit: false, cost: '0' }).costError).toBe(
      'forms.holding.propertyCostError',
    );
  });

  it('accepts a positive cost on create', () => {
    expect(propertyFieldErrors({ isEdit: false, cost: '5000' }).costError).toBeNull();
  });

  it('accepts a blank cost on edit (the field does not apply there)', () => {
    expect(propertyFieldErrors({ isEdit: true, cost: '' }).costError).toBeNull();
  });
});

describe('propertyReasonKey', () => {
  it('returns null once the cost passes', () => {
    expect(propertyReasonKey({ isEdit: false, cost: '5000' })).toBeNull();
  });

  it('returns the cost reason once it fails', () => {
    expect(propertyReasonKey({ isEdit: false, cost: '' })).toBe('forms.holding.propertyCostError');
  });

  it('never blocks on edit', () => {
    expect(propertyReasonKey({ isEdit: true, cost: '' })).toBeNull();
  });
});
