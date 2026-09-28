import {
  asBondMeta,
  asLoanMeta,
  asMetalMeta,
  asPropertyMeta,
  asTermDepositMeta,
  binanceHistoryCursorOf,
  loanKinds,
  loanSchedules,
  metalForms,
  metalUnits,
  preciousMetals,
  propertyCategoryOf,
  hasStoredBondPurchasePrice,
  syncedAtOf,
  walletAddressOf,
  withWalkOwnedMetadataCarried,
  withWalkOwnedMetadataResetToFloor,
} from './holding-metadata';
import type {
  BondMeta,
  CompoundingFrequency,
  LoanMeta,
  MetalMeta,
  PropertyMeta,
  TermDepositMeta,
} from './holding-metadata';

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

  it('tells a stored price apart from the nominal default of a bond without one', () => {
    const { purchasePriceMinorUnits: _, ...unpriced } = valid;

    expect(hasStoredBondPurchasePrice(valid)).toBe(true);
    expect(hasStoredBondPurchasePrice(unpriced)).toBe(false);
    expect(asBondMeta(unpriced)?.purchasePriceMinorUnits).toBe(1_000_000);
    expect(hasStoredBondPurchasePrice(null)).toBe(false);
  });

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

  it('rejects a present but wrong-type purchase price rather than defaulting it', () => {
    // Bad input (a stored purchase price of the wrong type) is rejected, not
    // silently replaced by the nominal default — that default is reserved for
    // a genuinely ABSENT field (a stored pre-field row).
    expect(asBondMeta({ ...valid, purchasePriceMinorUnits: '12' })).toBeNull();
    expect(asBondMeta({ ...valid, purchasePriceMinorUnits: Number.NaN })).toBeNull();
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

  it('defaults a missing kind to government (a stored pre-field row)', () => {
    expect(asBondMeta({ ...base })?.bondKind).toBe('government');
  });

  it('rejects a present but invalid kind rather than defaulting it', () => {
    expect(asBondMeta({ ...base, bondKind: 'nonsense' })).toBeNull();
  });
});

describe('asBondMeta isin', () => {
  const base = {
    quantity: 10,
    faceValueMinorUnits: 10000,
    couponPct: 10,
    purchaseDate: 1000,
    maturityDate: 2000,
  };

  it('round-trips a stored ISIN', () => {
    expect(asBondMeta({ ...base, isin: 'UA4000234215' })?.isin).toBe('UA4000234215');
  });

  it('leaves isin undefined when absent (a legacy Manual-mode bond)', () => {
    expect(asBondMeta({ ...base })?.isin).toBeUndefined();
  });

  it('rejects a present but non-string isin rather than dropping it', () => {
    expect(asBondMeta({ ...base, isin: 12345 })).toBeNull();
  });
});

describe('asBondMeta entryMode', () => {
  const base = {
    quantity: 10,
    faceValueMinorUnits: 10000,
    couponPct: 10,
    purchaseDate: 1000,
    maturityDate: 2000,
  };

  it('round-trips the mode the bond was saved from', () => {
    expect(asBondMeta({ ...base, entryMode: 'isin' })?.entryMode).toBe('isin');
    expect(asBondMeta({ ...base, entryMode: 'manual' })?.entryMode).toBe('manual');
  });

  it('leaves the mode out for a bond saved before it was stored', () => {
    expect(asBondMeta(base)).not.toHaveProperty('entryMode');
  });

  it('drops an unknown mode but keeps the bond', () => {
    const result = asBondMeta({ ...base, entryMode: 'register' });

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('entryMode');
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

  it('defaults a missing frequency to annually (a stored pre-field row)', () => {
    expect(asBondMeta({ ...base })?.couponFrequency).toBe('annually');
  });

  it('rejects a present but invalid frequency rather than defaulting it', () => {
    expect(asBondMeta({ ...base, couponFrequency: 'weekly' })).toBeNull();
  });
});

describe('asBondMeta payments', () => {
  const base = {
    quantity: 1000,
    faceValueMinorUnits: 100,
    couponPct: 4.5,
    purchaseDate: 1000,
    maturityDate: 2000,
    isin: 'XS2895055981',
  };
  const payments = [
    { date: 1500, kind: 'coupon', amount: '0.0225' },
    { date: 2000, kind: 'coupon', amount: '0.03' },
    { date: 2000, kind: 'redemption', amount: '1' },
  ];

  it('keeps a stored schedule', () => {
    expect(asBondMeta({ ...base, payments })?.payments).toEqual(payments);
  });

  it('keeps an empty schedule apart from an absent one', () => {
    expect(asBondMeta({ ...base, payments: [] })?.payments).toEqual([]);
    expect(asBondMeta(base)).not.toHaveProperty('payments');
  });

  it.each([
    ['a non-array', { kind: 'coupon' }],
    ['null', null],
    ['a non-number date', [{ ...payments[0], date: '1500' }]],
    ['an unknown kind', [{ ...payments[0], kind: 'dividend' }]],
    ['a number amount', [{ ...payments[0], amount: 0.0225 }]],
    ['a non-decimal amount', [{ ...payments[0], amount: '2.25e-2' }]],
    ['one malformed payment among valid ones', [...payments, { date: 3000 }]],
  ])('rejects the whole record for %s', (_label, invalid) => {
    expect(asBondMeta({ ...base, payments: invalid })).toBeNull();
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

describe('binanceHistoryCursorOf', () => {
  it('reads a finite binanceHistoryCursor timestamp', () => {
    expect(
      binanceHistoryCursorOf({ binanceAsset: 'BTC', binanceHistoryCursor: 1_704_326_400_000 }),
    ).toBe(1_704_326_400_000);
  });

  it('returns null when absent, non-numeric, or not an object', () => {
    expect(binanceHistoryCursorOf({ binanceAsset: 'BTC' })).toBeNull();
    expect(binanceHistoryCursorOf({ binanceHistoryCursor: 'yesterday' })).toBeNull();
    expect(binanceHistoryCursorOf({ binanceHistoryCursor: Number.NaN })).toBeNull();
    expect(binanceHistoryCursorOf(null)).toBeNull();
  });
});

describe('withWalkOwnedMetadataCarried', () => {
  it('carries a walk-owned key from the stored metadata onto the target', () => {
    const target = { binanceAsset: 'BTC', syncedAt: 2_000 };
    const stored = { binanceAsset: 'BTC', binanceHistoryCursor: 1_000, syncedAt: 1_000 };

    expect(withWalkOwnedMetadataCarried(target, stored)).toEqual({
      binanceAsset: 'BTC',
      syncedAt: 2_000,
      binanceHistoryCursor: 1_000,
    });
  });

  it('leaves the target unchanged when the stored metadata has no walk-owned key', () => {
    const target = { binanceAsset: 'BTC', syncedAt: 2_000 };

    expect(withWalkOwnedMetadataCarried(target, { binanceAsset: 'BTC' })).toEqual(target);
  });

  it('leaves the target unchanged when the stored metadata is null or not an object', () => {
    const target = { binanceAsset: 'BTC', syncedAt: 2_000 };

    expect(withWalkOwnedMetadataCarried(target, null)).toEqual(target);
    expect(withWalkOwnedMetadataCarried(target, 'not-an-object')).toEqual(target);
  });
});

describe('withWalkOwnedMetadataResetToFloor', () => {
  it('resets a stored walk-owned key to the given floor, leaving every other key untouched', () => {
    const stored = { binanceAsset: 'BTC', binanceHistoryCursor: 1_000, syncedAt: 500 };

    expect(withWalkOwnedMetadataResetToFloor(stored, 100)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 100,
      syncedAt: 500,
    });
  });

  it('returns undefined (nothing to change) when no walk-owned key is stored', () => {
    expect(
      withWalkOwnedMetadataResetToFloor({ binanceAsset: 'BTC', syncedAt: 500 }, 100),
    ).toBeUndefined();
    expect(withWalkOwnedMetadataResetToFloor({ walletAddress: 'bc1q' }, 100)).toBeUndefined();
  });

  it('returns undefined for null or non-object metadata', () => {
    expect(withWalkOwnedMetadataResetToFloor(null, 100)).toBeUndefined();
    expect(withWalkOwnedMetadataResetToFloor('not-an-object', 100)).toBeUndefined();
  });
});

describe('asPropertyMeta', () => {
  const valid = {
    category: 'real_estate' as const,
    lots: [{ day: 1_700_000_000_000, quantityDelta: '1', costMinorUnits: 5_000_000 }],
  };

  it('returns the typed object for a valid shape', () => {
    const result: PropertyMeta | null = asPropertyMeta(valid);
    expect(result).toEqual(valid);
  });

  it('accepts every category in the closed set', () => {
    const categories = [
      'real_estate',
      'vehicle',
      'valuable',
      'loan_given',
      'business_share',
      'other',
    ];

    for (const category of categories) {
      expect(asPropertyMeta({ ...valid, category })?.category).toBe(category);
    }
  });

  it('rejects an unknown category', () => {
    expect(asPropertyMeta({ ...valid, category: 'nonsense' })).toBeNull();
  });

  it('rejects a missing category', () => {
    const { category, ...rest } = valid;
    expect(asPropertyMeta(rest)).toBeNull();
  });

  it('rejects an invalid lots array', () => {
    expect(asPropertyMeta({ ...valid, lots: [{ day: 1, quantityDelta: 'abc' }] })).toBeNull();
  });

  it('accepts an empty lots array', () => {
    expect(asPropertyMeta({ ...valid, lots: [] })?.lots).toEqual([]);
  });

  it('returns null for null', () => {
    expect(asPropertyMeta(null)).toBeNull();
  });

  it('reads no ownership key as absent', () => {
    const result = asPropertyMeta(valid);

    expect(result).not.toHaveProperty('ownership');
    expect(result).not.toHaveProperty('ownershipInput');
  });

  it('keeps a valid ownership list and its input form', () => {
    const ownership = [{ day: 1_700_000_000_000, numerator: 1, denominator: 3 }];

    expect(asPropertyMeta({ ...valid, ownership, ownershipInput: 'fraction' })).toEqual({
      ...valid,
      ownership,
      ownershipInput: 'fraction',
    });
  });

  it('rejects an invalid ownership list', () => {
    const ownership = [{ day: 1_700_000_000_000, numerator: 4, denominator: 3 }];

    expect(asPropertyMeta({ ...valid, ownership })).toBeNull();
  });

  it('drops an unknown ownership input form rather than rejecting the row', () => {
    expect(asPropertyMeta({ ...valid, ownershipInput: 'decimal' })).toEqual(valid);
  });
});

describe('propertyCategoryOf', () => {
  it('reads a valid category off the metadata', () => {
    expect(propertyCategoryOf({ category: 'vehicle', lots: [] })).toBe('vehicle');
  });

  it('falls back to other for an unrecognized category', () => {
    expect(propertyCategoryOf({ category: 'nonsense', lots: [] })).toBe('other');
  });

  it('falls back to other for a missing category', () => {
    expect(propertyCategoryOf({ lots: [] })).toBe('other');
  });

  it('falls back to other for a non-record metadata value', () => {
    expect(propertyCategoryOf(null)).toBe('other');
    expect(propertyCategoryOf(undefined)).toBe('other');
  });
});

describe('asMetalMeta', () => {
  const valid = {
    metal: 'XAU' as const,
    form: 'bar' as const,
    unit: 'g' as const,
    purity: '0.9999',
    lots: [{ day: 1_700_000_000_000, quantityDelta: '10', costMinorUnits: 5_000_000 }],
  };

  it('returns the typed object for a valid shape', () => {
    const result: MetalMeta | null = asMetalMeta(valid);
    expect(result).toEqual(valid);
  });

  it('accepts every metal in the closed set', () => {
    for (const metal of preciousMetals) {
      expect(asMetalMeta({ ...valid, metal })?.metal).toBe(metal);
    }
  });

  it('accepts every form in the closed set', () => {
    for (const form of metalForms) {
      expect(asMetalMeta({ ...valid, form })?.form).toBe(form);
    }
  });

  it('accepts every unit in the closed set', () => {
    for (const unit of metalUnits) {
      expect(asMetalMeta({ ...valid, unit })?.unit).toBe(unit);
    }
  });

  it('rejects an unknown metal', () => {
    expect(asMetalMeta({ ...valid, metal: 'nonsense' })).toBeNull();
  });

  it('rejects an unknown form', () => {
    expect(asMetalMeta({ ...valid, form: 'nonsense' })).toBeNull();
  });

  it('rejects an unknown unit', () => {
    expect(asMetalMeta({ ...valid, unit: 'lb' })).toBeNull();
  });

  it('rejects a non-decimal purity', () => {
    expect(asMetalMeta({ ...valid, purity: 'abc' })).toBeNull();
    expect(asMetalMeta({ ...valid, purity: -1 })).toBeNull();
  });

  it('rejects a missing metal', () => {
    const { metal, ...rest } = valid;
    expect(asMetalMeta(rest)).toBeNull();
  });

  it('rejects an invalid lots array', () => {
    expect(asMetalMeta({ ...valid, lots: [{ day: 1, quantityDelta: 'abc' }] })).toBeNull();
  });

  it('accepts an empty lots array', () => {
    expect(asMetalMeta({ ...valid, lots: [] })?.lots).toEqual([]);
  });

  it('returns null for null', () => {
    expect(asMetalMeta(null)).toBeNull();
  });
});

describe('asLoanMeta', () => {
  const valid = {
    kind: 'mortgage' as const,
    principalMinorUnits: 120_000_00,
    startDate: 1_700_000_000_000,
    annualRatePct: 12,
    termMonths: 240,
    schedule: 'annuity' as const,
  };

  it('returns the typed object for a valid shape', () => {
    const result: LoanMeta | null = asLoanMeta(valid);
    expect(result).toEqual(valid);
  });

  it('accepts every loan kind in the closed set', () => {
    for (const kind of loanKinds) {
      expect(asLoanMeta({ ...valid, kind })?.kind).toBe(kind);
    }
  });

  it('accepts every schedule in the closed set', () => {
    for (const schedule of loanSchedules) {
      expect(asLoanMeta({ ...valid, schedule })?.schedule).toBe(schedule);
    }
  });

  it('rejects an unknown kind', () => {
    expect(asLoanMeta({ ...valid, kind: 'nonsense' })).toBeNull();
  });

  it('rejects an unknown schedule', () => {
    expect(asLoanMeta({ ...valid, schedule: 'nonsense' })).toBeNull();
  });

  it('rejects a non-numeric principal or start date', () => {
    expect(asLoanMeta({ ...valid, principalMinorUnits: 'abc' })).toBeNull();
    expect(asLoanMeta({ ...valid, startDate: 'abc' })).toBeNull();
  });

  it('rejects a missing kind', () => {
    const { kind, ...rest } = valid;
    expect(asLoanMeta(rest)).toBeNull();
  });

  it('rejects a missing schedule', () => {
    const { schedule, ...rest } = valid;
    expect(asLoanMeta(rest)).toBeNull();
  });

  it('allows annualRatePct and termMonths to be omitted (an informal, none-schedule loan)', () => {
    const { annualRatePct, termMonths, ...rest } = valid;
    const informal = { ...rest, schedule: 'none' as const };
    const result = asLoanMeta(informal);
    expect(result?.annualRatePct).toBeUndefined();
    expect(result?.termMonths).toBeUndefined();
  });

  it('rejects a non-numeric annualRatePct or termMonths when present', () => {
    expect(asLoanMeta({ ...valid, annualRatePct: 'abc' })).toBeNull();
    expect(asLoanMeta({ ...valid, termMonths: 'abc' })).toBeNull();
  });

  it('returns null for null', () => {
    expect(asLoanMeta(null)).toBeNull();
  });
});

describe('asLoanMeta paymentHoldingId/lenderName/lenderIban', () => {
  const valid = {
    kind: 'mortgage' as const,
    principalMinorUnits: 120_000_00,
    startDate: 1_700_000_000_000,
    annualRatePct: 12,
    termMonths: 240,
    schedule: 'annuity' as const,
  };

  it('leaves all three undefined when absent (a loan saved before this task)', () => {
    const result = asLoanMeta(valid);

    expect(result?.paymentHoldingId).toBeUndefined();
    expect(result?.lenderName).toBeUndefined();
    expect(result?.lenderIban).toBeUndefined();
  });

  it('accepts a present, valid paymentHoldingId/lenderName/lenderIban', () => {
    const result = asLoanMeta({
      ...valid,
      paymentHoldingId: 'h1',
      lenderName: 'PrivatBank',
      lenderIban: 'UA123456789012345678901234567',
    });

    expect(result?.paymentHoldingId).toBe('h1');
    expect(result?.lenderName).toBe('PrivatBank');
    expect(result?.lenderIban).toBe('UA123456789012345678901234567');
  });

  it('rejects the whole record when a present field is the wrong type', () => {
    expect(asLoanMeta({ ...valid, paymentHoldingId: 5 })).toBeNull();
    expect(asLoanMeta({ ...valid, lenderName: 5 })).toBeNull();
    expect(asLoanMeta({ ...valid, lenderIban: 5 })).toBeNull();
  });
});
