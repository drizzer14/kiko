import {
  asBondMeta,
  asLoanMeta,
  asMetalMeta,
  asPropertyMeta,
  asTermDepositMeta,
  BINANCE_EARN_HISTORY_CURSOR_FIELD,
  BINANCE_EARN_PENDING_OVERLAP_FIELD,
  BINANCE_EARN_POINT_CURSOR_FIELD,
  BINANCE_EARN_RANGE_CURSOR_FIELD,
  BINANCE_EARN_RESCAN_CURSOR_FIELD,
  BINANCE_EARN_SPAN_HINTS_FIELD,
  BINANCE_TRANSFER_HISTORY_CURSOR_FIELD,
  BINANCE_TRANSFER_PENDING_OVERLAP_FIELD,
  BINANCE_TRANSFER_POINT_CURSOR_FIELD,
  BINANCE_TRANSFER_RESCAN_CURSOR_FIELD,
  binanceWalkCursorFields,
  binanceWalkCursorOf,
  binanceWalkPendingFields,
  binanceWalkPendingOf,
  binanceWalkPointCursorFields,
  binanceWalkPointCursorOf,
  binanceWalkRangeCursorFields,
  binanceWalkRangeCursorOf,
  binanceWalkSpanHintFields,
  binanceWalkSpanHintsOf,
  loanKinds,
  loanKindOf,
  loanSchedules,
  metalForms,
  metalUnits,
  preciousMetals,
  propertyCategoryOf,
  hasStoredBondPurchasePrice,
  syncedAtOf,
  statementFromOf,
  syncClosedFromOf,
  walletAddressOf,
  withWalkOwnedMetadataCarried,
  withWalkOwnedMetadataResetToFloor,
  type BondMeta,
  type CompoundingFrequency,
  type LoanMeta,
  type MetalMeta,
  type PropertyMeta,
  type TermDepositMeta,
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

describe('syncClosedFromOf / statementFromOf', () => {
  it('read the stored number, or null when absent, non-numeric or not an object', () => {
    expect(syncClosedFromOf({ syncClosedFromMs: 1_000 })).toBe(1_000);
    expect(statementFromOf({ statementFromMs: 2_000 })).toBe(2_000);
    expect(syncClosedFromOf({ monobankId: 'a' })).toBeNull();
    expect(statementFromOf({ statementFromMs: 'soon' })).toBeNull();
    expect(syncClosedFromOf({ syncClosedFromMs: Number.NaN })).toBeNull();
    expect(statementFromOf(null)).toBeNull();
    expect(syncClosedFromOf('not-an-object')).toBeNull();
  });

  it('keep the two keys apart', () => {
    const metadata = { syncClosedFromMs: 1_000, statementFromMs: 2_000 };

    expect(syncClosedFromOf(metadata)).toBe(1_000);
    expect(statementFromOf(metadata)).toBe(2_000);
  });
});

describe('withWalkOwnedMetadataCarried — the reopen statement cursor', () => {
  it('carries statementFromMs, and never the sync-close mark', () => {
    const target = { monobankId: 'card-1', syncedAt: 2_000 };
    const stored = { monobankId: 'card-1', statementFromMs: 500, syncClosedFromMs: 400 };

    expect(withWalkOwnedMetadataCarried(target, stored)).toEqual({
      monobankId: 'card-1',
      syncedAt: 2_000,
      statementFromMs: 500,
    });
  });
});

describe('withWalkOwnedMetadataResetToFloor — the reopen statement cursor', () => {
  it('leaves statementFromMs untouched (the floor reset is Binance-only)', () => {
    const stored = { monobankId: 'card-1', statementFromMs: 500 };

    expect(withWalkOwnedMetadataResetToFloor(stored, 100)).toBeUndefined();
    expect(
      withWalkOwnedMetadataResetToFloor({ ...stored, binanceHistoryCursor: 900 }, 100),
    ).toEqual({ monobankId: 'card-1', statementFromMs: 500, binanceHistoryCursor: 100 });
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

describe('the Binance walk cursors', () => {
  const allCursors = {
    binanceHistoryCursor: 1_000,
    binanceHistoryRescanCursor: 1_500,
    binancePayHistoryCursor: 2_000,
    binancePayRescanCursor: 2_500,
    binanceTransferHistoryCursor: 3_000,
    binanceTransferRescanCursor: 3_500,
    binanceEarnHistoryCursor: 4_000,
    binanceEarnRescanCursor: 4_500,
  };

  it('lists the cursor and re-scan field of the capital, Pay, Transfer and Earn walks in walk order', () => {
    expect(binanceWalkCursorFields).toEqual([
      'binanceHistoryCursor',
      'binanceHistoryRescanCursor',
      'binancePayHistoryCursor',
      'binancePayRescanCursor',
      'binanceTransferHistoryCursor',
      'binanceTransferRescanCursor',
      'binanceEarnHistoryCursor',
      'binanceEarnRescanCursor',
    ]);
  });

  it('exports the Transfer cursor and re-scan field names the walk stores them under', () => {
    expect(BINANCE_TRANSFER_HISTORY_CURSOR_FIELD).toBe('binanceTransferHistoryCursor');
    expect(BINANCE_TRANSFER_RESCAN_CURSOR_FIELD).toBe('binanceTransferRescanCursor');
    expect(BINANCE_TRANSFER_PENDING_OVERLAP_FIELD).toBe('binanceTransferPendingOverlap');
    expect(BINANCE_TRANSFER_POINT_CURSOR_FIELD).toBe('binanceTransferPointCursor');
  });

  it('exports the six field names the Earn walk stores its marks under', () => {
    expect(BINANCE_EARN_HISTORY_CURSOR_FIELD).toBe('binanceEarnHistoryCursor');
    expect(BINANCE_EARN_RESCAN_CURSOR_FIELD).toBe('binanceEarnRescanCursor');
    expect(BINANCE_EARN_PENDING_OVERLAP_FIELD).toBe('binanceEarnPendingOverlap');
    expect(BINANCE_EARN_POINT_CURSOR_FIELD).toBe('binanceEarnPointCursor');
    expect(BINANCE_EARN_RANGE_CURSOR_FIELD).toBe('binanceEarnRangeCursor');
    expect(BINANCE_EARN_SPAN_HINTS_FIELD).toBe('binanceEarnSpanHints');
  });

  it('reads each field on its own, null when absent or not a finite number', () => {
    for (const field of binanceWalkCursorFields) {
      expect(binanceWalkCursorOf(field, { [field]: 5_000 })).toBe(5_000);
      expect(binanceWalkCursorOf(field, { [field]: 'soon' })).toBeNull();
      expect(binanceWalkCursorOf(field, { [field]: Number.NaN })).toBeNull();
      expect(binanceWalkCursorOf(field, { binanceAsset: 'BTC' })).toBeNull();
      expect(binanceWalkCursorOf(field, null)).toBeNull();
    }

    expect(binanceWalkCursorOf('binancePayHistoryCursor', allCursors)).toBe(2_000);
  });

  it('are all carried over a balance-sync metadata write', () => {
    const target = { binanceAsset: 'BTC', syncedAt: 9_000 };

    expect(withWalkOwnedMetadataCarried(target, { binanceAsset: 'BTC', ...allCursors })).toEqual({
      binanceAsset: 'BTC',
      syncedAt: 9_000,
      ...allCursors,
    });
  });

  it('are all reset to the floor on disconnect, while statementFromMs is not', () => {
    const stored = { binanceAsset: 'BTC', ...allCursors, statementFromMs: 700 };

    expect(withWalkOwnedMetadataResetToFloor(stored, 100)).toEqual({
      binanceAsset: 'BTC',
      binanceHistoryCursor: 100,
      binanceHistoryRescanCursor: 100,
      binancePayHistoryCursor: 100,
      binancePayRescanCursor: 100,
      binanceTransferHistoryCursor: 100,
      binanceTransferRescanCursor: 100,
      binanceEarnHistoryCursor: 100,
      binanceEarnRescanCursor: 100,
      statementFromMs: 700,
    });
  });

  it('resets a cursor a holding carries even when it carries only one of the new ones', () => {
    expect(
      withWalkOwnedMetadataResetToFloor(
        { binanceAsset: 'BTC', binanceEarnHistoryCursor: 4_000 },
        100,
      ),
    ).toEqual({ binanceAsset: 'BTC', binanceEarnHistoryCursor: 100 });
  });
});

describe('the Binance pending overlap lists', () => {
  const range = { start: 1_000, end: 2_000 };

  it('lists the capital, Pay, Transfer and Earn fields', () => {
    expect(binanceWalkPendingFields).toEqual([
      'binanceHistoryPendingOverlap',
      'binancePayPendingOverlap',
      'binanceTransferPendingOverlap',
      'binanceEarnPendingOverlap',
    ]);
  });

  it('reads each stored list on its own', () => {
    for (const field of binanceWalkPendingFields) {
      expect(binanceWalkPendingOf(field, { [field]: [range, { start: 5, end: 9 }] })).toEqual([
        range,
        { start: 5, end: 9 },
      ]);
      expect(binanceWalkPendingOf(field, { [field]: [] })).toEqual([]);
    }

    expect(
      binanceWalkPendingOf('binancePayPendingOverlap', { binanceHistoryPendingOverlap: [range] }),
    ).toEqual([]);
  });

  it('reads an entry with no kind as a range, and one tagged "point" as a point', () => {
    const point = { start: 999, end: 1_001, kind: 'point' };

    expect(
      binanceWalkPendingOf('binancePayPendingOverlap', {
        binancePayPendingOverlap: [range, point],
      }),
    ).toEqual([range, point]);
  });

  it('round-trips the series of a point, the one series its record was read in', () => {
    const typed = { start: 999, end: 1_001, kind: 'point', series: 'MAIN_FUNDING' };

    expect(
      binanceWalkPendingOf('binanceTransferPendingOverlap', {
        binanceTransferPendingOverlap: [range, typed],
      }),
    ).toEqual([range, typed]);
  });

  it('reads a point with no series as a point with none', () => {
    const point = { start: 999, end: 1_001, kind: 'point' };

    expect(
      binanceWalkPendingOf('binanceTransferPendingOverlap', {
        binanceTransferPendingOverlap: [point],
      }),
    ).toEqual([point]);
  });

  it.each([
    ['a range with a series', { start: 1_000, end: 2_000, series: 'MAIN_FUNDING' }],
    ['a point with an empty series', { start: 999, end: 1_001, kind: 'point', series: '' }],
    ['a point with a blank series', { start: 999, end: 1_001, kind: 'point', series: '  ' }],
    ['a point whose series is not text', { start: 999, end: 1_001, kind: 'point', series: 7 }],
    ['a point whose series is null', { start: 999, end: 1_001, kind: 'point', series: null }],
  ])('is undefined for a stored value with %s', (_label, entry) => {
    expect(
      binanceWalkPendingOf('binanceTransferPendingOverlap', {
        binanceTransferPendingOverlap: [entry],
      }),
    ).toBeUndefined();
  });

  it('reads a short entry with no kind as a range: only the tag makes a point', () => {
    const sliver = { start: 1_000, end: 1_002 };

    expect(
      binanceWalkPendingOf('binancePayPendingOverlap', { binancePayPendingOverlap: [sliver] }),
    ).toEqual([sliver]);
  });

  it('is an empty list when the key is absent or the metadata is not an object', () => {
    expect(binanceWalkPendingOf('binancePayPendingOverlap', { binanceAsset: 'BTC' })).toEqual([]);
    expect(binanceWalkPendingOf('binancePayPendingOverlap', null)).toEqual([]);
    expect(binanceWalkPendingOf('binancePayPendingOverlap', 'not-an-object')).toEqual([]);
  });

  it.each([
    ['not a list', { start: 1, end: 2 }],
    ['a list of numbers', [1_000, 2_000]],
    ['an entry with a missing end', [{ start: 1_000 }]],
    ['a text bound', [{ start: '1000', end: 2_000 }]],
    ['a non-finite bound', [{ start: Number.NaN, end: 2_000 }]],
    ['an empty range', [{ start: 2_000, end: 2_000 }]],
    ['a backwards range', [{ start: 3_000, end: 2_000 }]],
    ['one good and one bad entry', [range, { start: 'x', end: 1 }]],
    ['an entry of an unknown kind', [{ start: 1_000, end: 2_000, kind: 'range' }]],
    ['an entry whose kind is not text', [{ start: 1_000, end: 2_000, kind: 1 }]],
    ['a point that is empty', [{ start: 2_000, end: 2_000, kind: 'point' }]],
  ])('is undefined for a stored value that is %s', (_label, value) => {
    expect(
      binanceWalkPendingOf('binancePayPendingOverlap', { binancePayPendingOverlap: value }),
    ).toBe(undefined);
  });

  it('are carried over a balance-sync metadata write', () => {
    const target = { binanceAsset: 'BTC', syncedAt: 9_000 };
    const typedPoint = { start: 5, end: 7, kind: 'point', series: 'MAIN_FUNDING' };
    const stored = {
      binanceAsset: 'BTC',
      binanceHistoryPendingOverlap: [range],
      binancePayPendingOverlap: [],
      binanceTransferPendingOverlap: [typedPoint],
    };

    expect(withWalkOwnedMetadataCarried(target, stored)).toEqual({
      binanceAsset: 'BTC',
      syncedAt: 9_000,
      binanceHistoryPendingOverlap: [range],
      binancePayPendingOverlap: [],
      binanceTransferPendingOverlap: [typedPoint],
    });
  });

  it('are reset to an empty list on disconnect, beside the cursors reset to the floor', () => {
    const stored = {
      binanceAsset: 'BTC',
      binancePayHistoryCursor: 2_000,
      binancePayPendingOverlap: [range],
      binanceHistoryPendingOverlap: [range],
      binanceTransferPendingOverlap: [{ start: 5, end: 7, kind: 'point', series: 'MAIN_FUNDING' }],
    };

    expect(withWalkOwnedMetadataResetToFloor(stored, 100)).toEqual({
      binanceAsset: 'BTC',
      binancePayHistoryCursor: 100,
      binancePayPendingOverlap: [],
      binanceHistoryPendingOverlap: [],
      binanceTransferPendingOverlap: [],
    });
  });

  it('are reset when a holding carries a list and no cursor', () => {
    expect(
      withWalkOwnedMetadataResetToFloor(
        { binanceAsset: 'BTC', binanceHistoryPendingOverlap: [range] },
        100,
      ),
    ).toEqual({ binanceAsset: 'BTC', binanceHistoryPendingOverlap: [] });
  });
});

describe('the Binance point cursors', () => {
  it('lists the capital, Pay, Transfer and Earn fields', () => {
    expect(binanceWalkPointCursorFields).toEqual([
      'binanceHistoryPointCursor',
      'binancePayPointCursor',
      'binanceTransferPointCursor',
      'binanceEarnPointCursor',
    ]);
  });

  it('reads each stored cursor on its own', () => {
    for (const field of binanceWalkPointCursorFields) {
      expect(binanceWalkPointCursorOf(field, { [field]: 5_000 })).toBe(5_000);
    }

    expect(
      binanceWalkPointCursorOf('binancePayPointCursor', { binanceHistoryPointCursor: 5_000 }),
    ).toBeNull();
  });

  it('is null when the key is absent or the metadata is not an object', () => {
    expect(binanceWalkPointCursorOf('binancePayPointCursor', { binanceAsset: 'BTC' })).toBeNull();
    expect(binanceWalkPointCursorOf('binancePayPointCursor', null)).toBeNull();
    expect(binanceWalkPointCursorOf('binancePayPointCursor', 'not-an-object')).toBeNull();
  });

  it.each([
    ['text', '5000'],
    ['not a finite number', Number.NaN],
    ['null', null],
    ['a list', [5_000]],
  ])('is undefined for a stored value that is %s', (_label, value) => {
    expect(
      binanceWalkPointCursorOf('binancePayPointCursor', { binancePayPointCursor: value }),
    ).toBeUndefined();
  });

  it('are carried over a balance-sync metadata write', () => {
    const stored = {
      binanceAsset: 'BTC',
      binanceHistoryPointCursor: 7,
      binancePayPointCursor: 9,
      binanceTransferPointCursor: 11,
    };

    expect(withWalkOwnedMetadataCarried({ binanceAsset: 'BTC', syncedAt: 1 }, stored)).toEqual({
      binanceAsset: 'BTC',
      syncedAt: 1,
      binanceHistoryPointCursor: 7,
      binancePayPointCursor: 9,
      binanceTransferPointCursor: 11,
    });
  });

  it('are dropped on disconnect, beside the cursors reset to the floor', () => {
    const stored = {
      binanceAsset: 'BTC',
      binancePayHistoryCursor: 2_000,
      binancePayPointCursor: 9,
      binanceHistoryPointCursor: 7,
      binanceTransferPointCursor: 11,
    };

    expect(withWalkOwnedMetadataResetToFloor(stored, 100)).toEqual({
      binanceAsset: 'BTC',
      binancePayHistoryCursor: 100,
    });
  });

  it('are dropped when a holding carries a point cursor and nothing else of the walk', () => {
    expect(
      withWalkOwnedMetadataResetToFloor({ binanceAsset: 'BTC', binancePayPointCursor: 9 }, 100),
    ).toEqual({ binanceAsset: 'BTC' });
  });
});

describe('the Binance range cursors', () => {
  it('lists the capital, Pay, Transfer and Earn fields', () => {
    expect(binanceWalkRangeCursorFields).toEqual([
      'binanceHistoryRangeCursor',
      'binancePayRangeCursor',
      'binanceTransferRangeCursor',
      'binanceEarnRangeCursor',
    ]);
  });

  it('reads each stored cursor on its own', () => {
    for (const field of binanceWalkRangeCursorFields) {
      expect(binanceWalkRangeCursorOf(field, { [field]: 5_000 })).toBe(5_000);
    }

    expect(
      binanceWalkRangeCursorOf('binancePayRangeCursor', { binanceHistoryRangeCursor: 5_000 }),
    ).toBeNull();
  });

  it('is null when the key is absent or the metadata is not an object', () => {
    expect(binanceWalkRangeCursorOf('binancePayRangeCursor', { binanceAsset: 'BTC' })).toBeNull();
    expect(binanceWalkRangeCursorOf('binancePayRangeCursor', null)).toBeNull();
    expect(binanceWalkRangeCursorOf('binancePayRangeCursor', 'not-an-object')).toBeNull();
  });

  it.each([
    ['text', '5000'],
    ['not a finite number', Number.NaN],
    ['null', null],
    ['a list', [5_000]],
  ])('is undefined for a stored value that is %s', (_label, value) => {
    expect(
      binanceWalkRangeCursorOf('binancePayRangeCursor', { binancePayRangeCursor: value }),
    ).toBeUndefined();
  });

  it('are carried over a balance-sync metadata write', () => {
    const stored = {
      binanceAsset: 'BTC',
      binanceHistoryRangeCursor: 7,
      binancePayRangeCursor: 9,
      binanceTransferRangeCursor: 11,
    };

    expect(withWalkOwnedMetadataCarried({ binanceAsset: 'BTC', syncedAt: 1 }, stored)).toEqual({
      binanceAsset: 'BTC',
      syncedAt: 1,
      binanceHistoryRangeCursor: 7,
      binancePayRangeCursor: 9,
      binanceTransferRangeCursor: 11,
    });
  });

  it('are dropped on disconnect, beside the cursors reset to the floor', () => {
    const stored = {
      binanceAsset: 'BTC',
      binancePayHistoryCursor: 2_000,
      binancePayRangeCursor: 9,
      binanceHistoryRangeCursor: 7,
      binanceTransferRangeCursor: 11,
    };

    expect(withWalkOwnedMetadataResetToFloor(stored, 100)).toEqual({
      binanceAsset: 'BTC',
      binancePayHistoryCursor: 100,
    });
  });

  it('are dropped when a holding carries a range cursor and nothing else of the walk', () => {
    expect(
      withWalkOwnedMetadataResetToFloor({ binanceAsset: 'BTC', binancePayRangeCursor: 9 }, 100),
    ).toEqual({ binanceAsset: 'BTC' });
  });
});

describe('the Binance span hints', () => {
  const none = { forward: [], pending: [], rescan: [], point: [] };
  const hints = {
    forward: [{ start: 100, end: 150 }],
    pending: [
      { start: 200, end: 220 },
      { start: 300, end: 301 },
    ],
    rescan: [],
    point: [{ start: 400, end: 402 }],
  };

  it('lists the capital, Pay, Transfer and Earn fields', () => {
    expect(binanceWalkSpanHintFields).toEqual([
      'binanceHistorySpanHints',
      'binancePaySpanHints',
      'binanceTransferSpanHints',
      'binanceEarnSpanHints',
    ]);
  });

  it('reads each stored value on its own', () => {
    for (const field of binanceWalkSpanHintFields) {
      expect(binanceWalkSpanHintsOf(field, { [field]: hints })).toEqual(hints);
    }

    expect(
      binanceWalkSpanHintsOf('binancePaySpanHints', { binanceHistorySpanHints: hints }),
    ).toEqual(none);
  });

  it('is no hint at all when the key is absent or the metadata is not an object', () => {
    expect(binanceWalkSpanHintsOf('binancePaySpanHints', { binanceAsset: 'BTC' })).toEqual(none);
    expect(binanceWalkSpanHintsOf('binancePaySpanHints', null)).toEqual(none);
    expect(binanceWalkSpanHintsOf('binancePaySpanHints', 'not-an-object')).toEqual(none);
  });

  it('reads a pass left out as no hint for it', () => {
    expect(
      binanceWalkSpanHintsOf('binancePaySpanHints', {
        binancePaySpanHints: { rescan: [{ start: 1, end: 2 }] },
      }),
    ).toEqual({ ...none, rescan: [{ start: 1, end: 2 }] });
  });

  it.each([
    ['text', 'x'],
    ['null', null],
    ['a list', [{ start: 1, end: 2 }]],
    ['a pass that is no list', { ...hints, forward: { start: 1, end: 2 } }],
    ['an entry that is no object', { ...hints, point: [5] }],
    ['an entry with a text start', { ...hints, point: [{ start: '1', end: 2 }] }],
    ['an entry with no end', { ...hints, point: [{ start: 1 }] }],
    [
      'an entry with a start that is not a finite number',
      { ...hints, forward: [{ start: Number.NaN, end: 2 }] },
    ],
    ['an entry that ends where it starts', { ...hints, forward: [{ start: 2, end: 2 }] }],
    ['an entry that ends before it starts', { ...hints, forward: [{ start: 3, end: 2 }] }],
  ])('is undefined for a stored value that is %s', (_label, value) => {
    expect(
      binanceWalkSpanHintsOf('binancePaySpanHints', { binancePaySpanHints: value }),
    ).toBeUndefined();
  });

  describe('the resume of a point window', () => {
    const resume = {
      from: 401,
      returned: [{ start: 400, end: 402, kind: 'point', series: 'MAIN_FUNDING' }],
      stuck: [
        { start: 400, end: 402, kind: 'point' },
        { start: 390, end: 410 },
      ],
      series: ['MAIN_FUNDING', 'FUNDING_MAIN'],
    };
    const resumed = { ...hints, point: [{ start: 400, end: 450, resume }] };
    const read = (stored: unknown) =>
      binanceWalkSpanHintsOf('binancePaySpanHints', { binancePaySpanHints: stored });

    it('is read with the points a record returned and the ground a record left owed', () => {
      expect(read(resumed)).toEqual(resumed);
    });

    it('is read with no series for a walk that reads one series', () => {
      const { series: _series, ...single } = resume;
      const stored = { ...hints, point: [{ start: 400, end: 450, resume: single }] };

      expect(read(stored)).toEqual(stored);
    });

    it('is dropped from a hint of any other pass, which keeps its span', () => {
      expect(
        read({
          forward: [{ start: 1, end: 5, resume }],
          pending: [{ start: 2, end: 6, resume }],
          rescan: [{ start: 3, end: 7, resume }],
          point: [],
        }),
      ).toEqual({
        forward: [{ start: 1, end: 5 }],
        pending: [{ start: 2, end: 6 }],
        rescan: [{ start: 3, end: 7 }],
        point: [],
      });
    });

    it.each([
      ['a resume that is no object', 'x'],
      ['a resume that starts at a text', { ...resume, from: '401' }],
      ['a resume that starts before its window', { ...resume, from: 399 }],
      ['a resume that starts where its span ends', { ...resume, from: 450 }],
      ['a resume that starts after its span ends', { ...resume, from: 451 }],
      ['a resume with no list of returned points', { ...resume, returned: undefined }],
      ['a resume whose returned points are no list', { ...resume, returned: 'x' }],
      ['a resume with a returned point that is no range', { ...resume, returned: [{ start: 1 }] }],
      ['a resume with no list of stuck ground', { ...resume, stuck: undefined }],
      [
        'a resume with a stuck entry of kind other than a point',
        {
          ...resume,
          stuck: [{ start: 1, end: 2, kind: 'range' }],
        },
      ],
      ['a resume whose series are no list', { ...resume, series: 'MAIN_FUNDING' }],
      ['a resume with an empty list of series', { ...resume, series: [] }],
      ['a resume with a series that is blank', { ...resume, series: [' '] }],
    ])('makes the stored value undefined for %s', (_label, bad) => {
      expect(read({ ...hints, point: [{ start: 400, end: 450, resume: bad }] })).toBeUndefined();
    });
  });

  it('are carried over a balance-sync metadata write', () => {
    const stored = {
      binanceAsset: 'BTC',
      binanceHistorySpanHints: hints,
      binancePaySpanHints: none,
      binanceTransferSpanHints: hints,
    };

    expect(withWalkOwnedMetadataCarried({ binanceAsset: 'BTC', syncedAt: 1 }, stored)).toEqual({
      ...stored,
      syncedAt: 1,
    });
  });

  it('are dropped on disconnect, beside the cursors reset to the floor', () => {
    const stored = {
      binanceAsset: 'BTC',
      binancePayHistoryCursor: 2_000,
      binanceHistorySpanHints: hints,
      binancePaySpanHints: hints,
      binanceTransferSpanHints: hints,
    };

    expect(withWalkOwnedMetadataResetToFloor(stored, 100)).toEqual({
      binanceAsset: 'BTC',
      binancePayHistoryCursor: 100,
    });
  });

  it('are dropped when a holding carries hints and nothing else of the walk', () => {
    expect(
      withWalkOwnedMetadataResetToFloor({ binanceAsset: 'BTC', binancePaySpanHints: hints }, 100),
    ).toEqual({ binanceAsset: 'BTC' });
  });
});

describe('the six keys of the Binance Earn walk', () => {
  const point = { start: 5, end: 7, kind: 'point', series: 'flexibleRewards' };
  const hints = { forward: [], pending: [{ start: 200, end: 220 }], rescan: [], point: [] };
  const stored = {
    binanceAsset: 'BTC',
    binanceEarnHistoryCursor: 4_000,
    binanceEarnRescanCursor: 3_000,
    binanceEarnPendingOverlap: [point],
    binanceEarnPointCursor: 6,
    binanceEarnRangeCursor: 9,
    binanceEarnSpanHints: hints,
  };

  it('are carried over a balance-sync metadata write', () => {
    expect(withWalkOwnedMetadataCarried({ binanceAsset: 'BTC', syncedAt: 1 }, stored)).toEqual({
      ...stored,
      syncedAt: 1,
    });
  });

  it('are reset on disconnect: the cursors to the floor, the list to empty, the round-robin marks and the hints dropped', () => {
    expect(withWalkOwnedMetadataResetToFloor(stored, 100)).toEqual({
      binanceAsset: 'BTC',
      binanceEarnHistoryCursor: 100,
      binanceEarnRescanCursor: 100,
      binanceEarnPendingOverlap: [],
    });
  });

  it('are read as the other walks read theirs: a list with a point of a kind, a cursor, a number, the hints', () => {
    expect(binanceWalkPendingOf(BINANCE_EARN_PENDING_OVERLAP_FIELD, stored)).toEqual([point]);
    expect(binanceWalkPointCursorOf(BINANCE_EARN_POINT_CURSOR_FIELD, stored)).toBe(6);
    expect(binanceWalkRangeCursorOf(BINANCE_EARN_RANGE_CURSOR_FIELD, stored)).toBe(9);
    expect(binanceWalkSpanHintsOf(BINANCE_EARN_SPAN_HINTS_FIELD, stored)).toEqual(hints);
    expect(binanceWalkCursorOf(BINANCE_EARN_RESCAN_CURSOR_FIELD, stored)).toBe(3_000);
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

describe('loanKindOf', () => {
  it('reads a valid kind off the metadata, whatever else the blob holds', () => {
    expect(loanKindOf({ kind: 'car_loan' })).toBe('car_loan');
    expect(loanKindOf({ kind: 'personal', principalMinorUnits: 'garbled' })).toBe('personal');
  });

  it('has no kind for an unrecognized or missing one', () => {
    expect(loanKindOf({ kind: 'nonsense' })).toBeUndefined();
    expect(loanKindOf({ principalMinorUnits: 1 })).toBeUndefined();
  });

  it('has no kind for a non-record metadata value', () => {
    expect(loanKindOf(null)).toBeUndefined();
    expect(loanKindOf('garbled')).toBeUndefined();
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
