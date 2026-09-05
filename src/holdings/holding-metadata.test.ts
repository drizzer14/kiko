import type { BondMeta, CompoundingFrequency, TermDepositMeta } from './holding-metadata';
import { asBondMeta, asTermDepositMeta, syncedAtOf, walletAddressOf } from './holding-metadata';

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

  it('accepts the new bi-weekly compounding option', () => {
    expect(asTermDepositMeta({ ...valid, compounding: 'bi-weekly' })?.compounding).toBe(
      'bi-weekly',
    );
  });

  it('migrates a legacy daily deposit to monthly (safe, conservative)', () => {
    // The 'daily' option was removed; existing records must still parse rather
    // than crash, mapped onto the calendar-anniversary 'monthly' mode.
    expect(asTermDepositMeta({ ...valid, compounding: 'daily' })?.compounding).toBe('monthly');
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
    purchasePriceMinorUnits: 980_000,
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

  it('reads an explicit purchase price', () => {
    expect(asBondMeta(valid)?.purchasePriceMinorUnits).toBe(980_000);
  });

  it('defaults a missing purchase price to the nominal (quantity * faceValue)', () => {
    const { purchasePriceMinorUnits, ...withoutPrice } = valid;
    expect(asBondMeta(withoutPrice)?.purchasePriceMinorUnits).toBe(10 * 100_000);
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

describe('walletAddressOf', () => {
  it('reads a string walletAddress', () => {
    expect(walletAddressOf({ walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' })).toBe(
      'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    );
  });

  it('returns undefined for null, non-object, or non-string metadata', () => {
    expect(walletAddressOf(null)).toBeUndefined();
    expect(walletAddressOf('bc1q')).toBeUndefined();
    expect(walletAddressOf({ walletAddress: 42 })).toBeUndefined();
    expect(walletAddressOf({ monobankId: 'x' })).toBeUndefined();
  });
});

describe('syncedAtOf', () => {
  it('reads a finite syncedAt timestamp', () => {
    expect(syncedAtOf({ walletAddress: 'bc1q', syncedAt: 1_704_326_400_000 })).toBe(
      1_704_326_400_000,
    );
  });

  it('returns null when absent, non-numeric, or not an object', () => {
    expect(syncedAtOf({ walletAddress: 'bc1q' })).toBeNull();
    expect(syncedAtOf({ syncedAt: 'yesterday' })).toBeNull();
    expect(syncedAtOf({ syncedAt: Number.NaN })).toBeNull();
    expect(syncedAtOf(null)).toBeNull();
  });
});
