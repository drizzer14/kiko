import type { BondMeta, CompoundingFrequency, TermDepositMeta } from './holding-metadata';
import { asBondMeta, asTermDepositMeta } from './holding-metadata';

describe('asTermDepositMeta', () => {
  const compounding: CompoundingFrequency = 'monthly';
  const valid = {
    contributions: [{ amountMinorUnits: 100_000, date: 1_700_000_000_000 }],
    annualRatePct: 15,
    termMonths: 12,
    recapitalization: true,
    compounding,
  };

  it('returns the typed object for a valid shape', () => {
    const result: TermDepositMeta | null = asTermDepositMeta(valid);
    expect(result).toEqual(valid);
  });

  it('returns null when a field is missing', () => {
    const { annualRatePct, ...rest } = valid;
    expect(asTermDepositMeta(rest)).toBeNull();
  });

  it('returns null for an unknown compounding value', () => {
    expect(asTermDepositMeta({ ...valid, compounding: 'weekly' })).toBeNull();
  });

  it('returns null for null', () => {
    expect(asTermDepositMeta(null)).toBeNull();
  });
});

describe('asTermDepositMeta contributions', () => {
  const base = {
    annualRatePct: 10,
    termMonths: 12,
    recapitalization: true,
    compounding: 'monthly',
  };

  it('reads a contributions list, sorted by date ascending', () => {
    const meta = asTermDepositMeta({
      ...base,
      contributions: [
        { amountMinorUnits: 500, date: 2000 },
        { amountMinorUnits: 100000, date: 1000 },
      ],
    });
    expect(meta?.contributions).toEqual([
      { amountMinorUnits: 100000, date: 1000 },
      { amountMinorUnits: 500, date: 2000 },
    ]);
  });

  it('normalizes the old principal + startDate shape to one contribution', () => {
    const meta = asTermDepositMeta({ ...base, principalMinorUnits: 100000, startDate: 1000 });
    expect(meta?.contributions).toEqual([{ amountMinorUnits: 100000, date: 1000 }]);
  });

  it('returns null when neither contributions nor the old shape is valid', () => {
    expect(asTermDepositMeta({ ...base })).toBeNull();
    expect(asTermDepositMeta({ ...base, contributions: [] })).toBeNull();
  });
});

describe('asBondMeta', () => {
  const valid = {
    quantity: 10,
    faceValueMinorUnits: 100_000,
    couponPct: 9,
    purchaseDate: 1_700_000_000_000,
    maturityDate: 1_800_000_000_000,
    bondKind: 'government' as const,
    couponFrequency: 'semiannually' as const,
  };

  it('returns the typed object for a valid shape', () => {
    const result: BondMeta | null = asBondMeta(valid);
    expect(result).toEqual(valid);
  });

  it('returns null when a field is the wrong type', () => {
    expect(asBondMeta({ ...valid, quantity: '10' })).toBeNull();
  });
});

describe('asBondMeta bondKind', () => {
  const base = {
    quantity: 10,
    faceValueMinorUnits: 10000,
    couponPct: 10,
    purchaseDate: 1000,
    maturityDate: 2000,
  };

  it('reads an explicit corporate kind', () => {
    expect(asBondMeta({ ...base, bondKind: 'corporate' })?.bondKind).toBe('corporate');
  });

  it('defaults a missing or invalid kind to government', () => {
    expect(asBondMeta({ ...base })?.bondKind).toBe('government');
    expect(asBondMeta({ ...base, bondKind: 'nonsense' })?.bondKind).toBe('government');
  });
});

describe('asBondMeta couponFrequency', () => {
  const base = {
    quantity: 10,
    faceValueMinorUnits: 10000,
    couponPct: 10,
    purchaseDate: 1000,
    maturityDate: 2000,
  };

  it('reads an explicit frequency', () => {
    expect(asBondMeta({ ...base, couponFrequency: 'quarterly' })?.couponFrequency).toBe(
      'quarterly',
    );
    expect(asBondMeta({ ...base, couponFrequency: 'semiannually' })?.couponFrequency).toBe(
      'semiannually',
    );
  });

  it('defaults a missing or invalid frequency to annually (back-compat)', () => {
    expect(asBondMeta({ ...base })?.couponFrequency).toBe('annually');
    expect(asBondMeta({ ...base, couponFrequency: 'weekly' })?.couponFrequency).toBe('annually');
  });
});
