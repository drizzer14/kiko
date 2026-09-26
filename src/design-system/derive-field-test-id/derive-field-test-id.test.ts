import { deriveFieldTestID } from './derive-field-test-id';

describe('deriveFieldTestID', () => {
  it('appends the suffix to the outer testID', () => {
    expect(deriveFieldTestID('amount-field', 'error')).toBe('amount-field-error');
  });

  it('returns undefined when the caller passed no testID', () => {
    expect(deriveFieldTestID(undefined, 'error')).toBeUndefined();
  });
});
