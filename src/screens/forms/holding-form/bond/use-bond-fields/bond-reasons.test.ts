import { bondFieldErrors, bondReasonKey } from './bond-reasons';

const baseParams = () => ({
  quantity: '10',
  faceValue: '1000',
  couponPct: '9',
  purchaseDate: 1_700_000_000_000,
  maturityDate: 1_800_000_000_000,
});

describe('bondFieldErrors — quantity', () => {
  it('rejects a blank quantity', () => {
    expect(bondFieldErrors({ ...baseParams(), quantity: '' }).quantityError).toBe(
      'forms.holding.quantityError',
    );
  });

  it('rejects a zero quantity', () => {
    expect(bondFieldErrors({ ...baseParams(), quantity: '0' }).quantityError).toBe(
      'forms.holding.quantityError',
    );
  });

  it('accepts a positive quantity', () => {
    expect(bondFieldErrors({ ...baseParams(), quantity: '10' }).quantityError).toBeNull();
  });
});

describe('bondFieldErrors — face value', () => {
  it('rejects a blank face value', () => {
    expect(bondFieldErrors({ ...baseParams(), faceValue: '' }).faceValueError).toBe(
      'forms.holding.faceValueError',
    );
  });

  it('rejects a zero face value', () => {
    expect(bondFieldErrors({ ...baseParams(), faceValue: '0' }).faceValueError).toBe(
      'forms.holding.faceValueError',
    );
  });

  it('accepts a positive face value', () => {
    expect(bondFieldErrors({ ...baseParams(), faceValue: '1000' }).faceValueError).toBeNull();
  });
});

describe('bondFieldErrors — coupon %', () => {
  it('rejects a blank coupon', () => {
    expect(bondFieldErrors({ ...baseParams(), couponPct: '' }).couponPctError).toBe(
      'forms.holding.couponPctError',
    );
  });

  it('rejects a negative coupon', () => {
    expect(bondFieldErrors({ ...baseParams(), couponPct: '-1' }).couponPctError).toBe(
      'forms.holding.couponPctError',
    );
  });

  it('accepts a zero coupon (a zero-coupon bond)', () => {
    expect(bondFieldErrors({ ...baseParams(), couponPct: '0' }).couponPctError).toBeNull();
  });

  it('accepts a positive coupon', () => {
    expect(bondFieldErrors({ ...baseParams(), couponPct: '9' }).couponPctError).toBeNull();
  });
});

describe('bondFieldErrors — purchase date', () => {
  it('requires a purchase date', () => {
    expect(bondFieldErrors({ ...baseParams(), purchaseDate: null }).purchaseDateError).toBe(
      'forms.holding.purchaseDateRequiredError',
    );
  });

  it('accepts a picked purchase date', () => {
    expect(
      bondFieldErrors({ ...baseParams(), purchaseDate: 1_700_000_000_000 }).purchaseDateError,
    ).toBeNull();
  });
});

describe('bondFieldErrors — maturity date', () => {
  it('requires a maturity date', () => {
    expect(bondFieldErrors({ ...baseParams(), maturityDate: null }).maturityDateError).toBe(
      'forms.holding.maturityDateRequiredError',
    );
  });

  it('rejects a maturity date on or before the purchase date', () => {
    expect(
      bondFieldErrors({
        ...baseParams(),
        purchaseDate: 1_700_000_000_000,
        maturityDate: 1_700_000_000_000,
      }).maturityDateError,
    ).toBe('forms.holding.maturityDateError');
  });

  it('accepts a maturity date after the purchase date', () => {
    expect(
      bondFieldErrors({
        ...baseParams(),
        purchaseDate: 1_700_000_000_000,
        maturityDate: 1_800_000_000_000,
      }).maturityDateError,
    ).toBeNull();
  });

  it('accepts a maturity date with no purchase date yet picked', () => {
    expect(
      bondFieldErrors({ ...baseParams(), purchaseDate: null, maturityDate: 1_800_000_000_000 })
        .maturityDateError,
    ).toBeNull();
  });
});

describe('bondReasonKey', () => {
  it('returns null once every field passes', () => {
    expect(bondReasonKey(baseParams())).toBeNull();
  });

  it('prioritizes the quantity reason over every other field', () => {
    expect(bondReasonKey({ ...baseParams(), quantity: '', faceValue: '', couponPct: '' })).toBe(
      'forms.holding.quantityError',
    );
  });

  it('prioritizes the face-value reason over coupon once quantity passes', () => {
    expect(bondReasonKey({ ...baseParams(), faceValue: '', couponPct: '' })).toBe(
      'forms.holding.faceValueError',
    );
  });

  it('prioritizes the coupon reason over the dates once quantity and face value pass', () => {
    expect(bondReasonKey({ ...baseParams(), couponPct: '', purchaseDate: null })).toBe(
      'forms.holding.couponPctError',
    );
  });

  it('prioritizes the purchase-date reason over maturity once the numeric fields pass', () => {
    expect(bondReasonKey({ ...baseParams(), purchaseDate: null, maturityDate: null })).toBe(
      'forms.holding.purchaseDateRequiredError',
    );
  });
});
