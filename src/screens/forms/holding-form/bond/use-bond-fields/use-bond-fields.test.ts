import { act, renderHook } from '@testing-library/react-native';

let mockBondRegisterRows: { isin: string; terms: unknown; fetchedAt: number }[] = [];
let mockFetchedAtRows: { value: number | null }[] = [{ value: 1 }];

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: { __kind?: string }) =>
    query.__kind === 'fetchedAt' ? { data: mockFetchedAtRows } : { data: mockBondRegisterRows },
}));

jest.mock('@kiko/bonds/bond-register-repo', () => ({
  bondRegisterRepo: {
    findByIsinQuery: () => ({ __kind: 'findByIsin', toSQL: () => ({ sql: '', params: [] }) }),
    fetchedAtQuery: () => ({ __kind: 'fetchedAt', toSQL: () => ({ sql: '', params: [] }) }),
  },
  refreshBondRegisterIfStale: jest.fn().mockResolvedValue(undefined),
}));

// The row as stored when the edit write runs, which a register refresh can
// change after the form seeded.
let mockStoredMetadata: unknown;
const mockWrittenMetadata: Record<string, unknown>[] = [];

jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    updateMetadataFromStored: async (
      _holdingId: string,
      _patch: unknown,
      buildMetadata: (storedMetadata: unknown) => Record<string, unknown>,
    ) => {
      mockWrittenMetadata.push(buildMetadata(mockStoredMetadata));
    },
  },
}));

import type { HoldingRow } from '@kiko/db';
import { EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { bondYieldToMaturity } from '@kiko/bonds/yield-to-maturity';

import type { EditContext } from '../../holding-type-form';

import { useBondFields, type UseBondFieldsResult } from './use-bond-fields';

// UA4000234215: a real register ISIN, checksum-valid.
const VALID_ISIN = 'UA4000234215';

const foundRow = (
  overrides: { currency?: string; couponFrequency?: string | null; maturityDate?: number } = {},
) => ({
  isin: VALID_ISIN,
  terms: {
    isin: VALID_ISIN,
    currency: overrides.currency ?? 'UAH',
    faceValueMinorUnits: 100_000,
    couponPct: 9.5,
    maturityDate: overrides.maturityDate ?? new Date(2029, 5, 24).getTime(),
    couponFrequency: 'couponFrequency' in overrides ? overrides.couponFrequency : 'quarterly',
    name: 'Register Bond',
  },
  fetchedAt: 1,
});

const renderBondFields = (isEdit = false, setName: (value: string) => void = jest.fn()) =>
  renderHook(() =>
    useBondFields({
      type: 'bond',
      isEdit,
      currency: 'UAH',
      setCurrency: jest.fn(),
      name: isEdit ? 'Bond' : '',
      setName,
    }),
  );

beforeEach(() => {
  mockBondRegisterRows = [];
  mockFetchedAtRows = [{ value: 1 }];
  mockStoredMetadata = undefined;
  mockWrittenMetadata.length = 0;
});

describe('useBondFields kept payment schedule', () => {
  const payments = [
    { date: new Date(2027, 2, 24).getTime(), kind: 'coupon', amount: '23.75' },
    { date: new Date(2029, 5, 24).getTime(), kind: 'redemption', amount: '1000' },
  ];
  const withPayments = () => {
    const row = foundRow();

    return { ...row, terms: { ...row.terms, payments } };
  };

  it('keeps the register schedule of a bond created in ISIN mode', async () => {
    mockBondRegisterRows = [withPayments()];
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.createPayload().metadata).toMatchObject({ isin: VALID_ISIN, payments });
  });

  const bondMetadata = {
    quantity: 10,
    faceValueMinorUnits: 100_000,
    couponPct: 9.5,
    purchaseDate: new Date(2026, 8, 1).getTime(),
    maturityDate: new Date(2029, 5, 24).getTime(),
    couponFrequency: 'quarterly',
    isin: VALID_ISIN,
  };
  const bondHolding = (metadata: Record<string, unknown>) =>
    ({ currency: 'UAH', metadata }) as unknown as HoldingRow;
  const context = (holding: HoldingRow): EditContext => ({
    holdingId: 'h1',
    name: 'Bond',
    color: null,
    currency: 'UAH',
    isSynced: false,
    editingHolding: holding,
    book: EMPTY_PRICE_BOOK,
  });

  it('drops the kept schedule once the coupon is edited, saving the edited coupon', async () => {
    mockBondRegisterRows = [withPayments()];
    const holding = bondHolding({ ...bondMetadata, entryMode: 'manual', payments });
    mockStoredMetadata = holding.metadata;
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(holding);
    });
    await result.current.saveEdit(context(holding));

    expect(mockWrittenMetadata.at(-1)).toMatchObject({ payments });

    await act(async () => {
      result.current.setCouponPct('12');
    });
    await result.current.saveEdit(context(holding));

    expect(mockWrittenMetadata.at(-1)).toMatchObject({ couponPct: 12, payments: [] });
  });

  // The register now pays a stepped-up 9.5% while the bond was saved at 9.0%:
  // looking at ISIN mode must not turn the stored coupon into a typed one.
  it('keeps the stored name, coupon and schedule after a tap on ISIN and back to Manual', async () => {
    mockBondRegisterRows = [withPayments()];
    const holding = bondHolding({ ...bondMetadata, couponPct: 9, payments });
    mockStoredMetadata = holding.metadata;
    const setName = jest.fn();
    const { result } = await renderBondFields(true, setName);

    await act(async () => {
      result.current.seed(holding);
    });
    await act(async () => {
      result.current.setBondMode('isin');
    });
    await act(async () => {
      result.current.setBondMode('manual');
    });
    await result.current.saveEdit(context(holding));

    expect(setName).not.toHaveBeenCalled();
    expect(mockWrittenMetadata.at(-1)).toMatchObject({ couponPct: 9, payments });
  });

  it('keeps an edit of a stored unmapped-frequency ISIN saveable in ISIN mode', async () => {
    mockBondRegisterRows = [foundRow({ couponFrequency: null })];
    const holding = bondHolding({
      ...bondMetadata,
      purchasePriceMinorUnits: 1_000_000,
      couponFrequency: 'annually',
    });
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(holding);
    });
    await act(async () => {
      result.current.setBondMode('isin');
    });

    expect(result.current.bondMode).toBe('isin');
    expect(result.current.needsCouponFrequencyPick).toBe(true);
    expect(result.current.isValid).toBe(true);
  });

  // A bond saved before bonds kept a schedule: the edit form's own register
  // refresh keeps the schedule in the row and drops the ISIN from the cache
  // after the form seeded.
  it('keeps a schedule stored after the form seeded through a Save with the coupon unchanged', async () => {
    const legacy = bondHolding(bondMetadata);
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(legacy);
    });
    mockStoredMetadata = { ...bondMetadata, payments };
    await act(async () => {
      result.current.setQuantity('12');
    });
    await result.current.saveEdit(context(legacy));

    expect(mockWrittenMetadata.at(-1)).toMatchObject({ quantity: 12, payments });

    await act(async () => {
      result.current.setCouponPct('12');
    });
    await result.current.saveEdit(context(legacy));

    expect(mockWrittenMetadata.at(-1)).toMatchObject({ couponPct: 12, payments: [] });
  });
});

// XS2895055981 pays 0.0225 per 1-dollar bond (4.5%) up to 2027-02 and 0.03
// (6%) from 2027-08. The bond was saved at 4.5% with its schedule kept.
describe('useBondFields coupon of a bond with a kept schedule (user ruling)', () => {
  const stepUpIsin = 'XS2895055981';
  const stepUpPayments = [
    { date: new Date(2027, 1, 1).getTime(), kind: 'coupon', amount: '0.0225' },
    { date: new Date(2027, 7, 1).getTime(), kind: 'coupon', amount: '0.03' },
    { date: new Date(2028, 1, 1).getTime(), kind: 'coupon', amount: '0.03' },
    { date: new Date(2029, 1, 1).getTime(), kind: 'redemption', amount: '1' },
  ];
  const stepUpMetadata = {
    quantity: 1000,
    faceValueMinorUnits: 100,
    couponPct: 4.5,
    purchasePriceMinorUnits: 98_000,
    purchaseDate: new Date(2026, 8, 26).getTime(),
    maturityDate: new Date(2029, 1, 1).getTime(),
    bondKind: 'government',
    couponFrequency: 'semiannually',
    isin: stepUpIsin,
    entryMode: 'manual',
    payments: stepUpPayments,
  };
  const stepUpRow = {
    isin: stepUpIsin,
    terms: {
      isin: stepUpIsin,
      currency: 'USD',
      faceValueMinorUnits: 100,
      couponPct: 4.5,
      maturityDate: new Date(2029, 1, 1).getTime(),
      couponFrequency: 'semiannually',
      name: 'OЗДП-середньострокова XS2895055981',
      payments: stepUpPayments,
    },
    fetchedAt: new Date(2026, 8, 26).getTime(),
  };
  const beforeStep = new Date(2027, 0, 20).getTime();
  const afterStep = new Date(2027, 7, 15).getTime();

  const holdingOf = (metadata: Record<string, unknown>) =>
    ({ currency: 'USD', metadata }) as unknown as HoldingRow;
  const contextOf = (holding: HoldingRow): EditContext => ({
    holdingId: 'h1',
    name: 'Bond',
    color: null,
    currency: 'USD',
    isSynced: false,
    editingHolding: holding,
    book: EMPTY_PRICE_BOOK,
  });

  const seededOn = async (today: number, metadata: Record<string, unknown>) => {
    jest.spyOn(Date, 'now').mockReturnValue(today);
    mockStoredMetadata = metadata;
    const holding = holdingOf(metadata);
    const { result } = await renderHook(() =>
      useBondFields({
        type: 'bond',
        isEdit: true,
        currency: 'USD',
        setCurrency: jest.fn(),
        name: 'Bond',
        setName: jest.fn(),
      }),
    );

    await act(async () => {
      result.current.seed(holding);
    });

    return { result, holding };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['before the step', beforeStep, '4.5'],
    ['after the step', afterStep, '6'],
  ])(
    'shows the coupon in force %s in Manual mode; an untouched Save keeps what is stored',
    async (_case, today, shown) => {
      const { result, holding } = await seededOn(today, stepUpMetadata);

      expect(result.current.bondMode).toBe('manual');
      expect(result.current.scheduledCouponPct).toBe(shown);
      expect(result.current.couponPct).toBe('4.5');
      expect(result.current.isValid).toBe(true);

      await result.current.saveEdit(contextOf(holding));

      expect(mockWrittenMetadata.at(-1)).toEqual(stepUpMetadata);
    },
  );

  it.each([
    ['before the step', beforeStep, 4.5],
    ['after the step', afterStep, 6],
  ])(
    'shows the same coupon %s in ISIN mode; an untouched Save keeps what is stored',
    async (_case, today, shown) => {
      mockBondRegisterRows = [stepUpRow];
      const isinMetadata = { ...stepUpMetadata, entryMode: 'isin' };
      const { result, holding } = await seededOn(today, isinMetadata);

      expect(result.current.bondMode).toBe('isin');
      expect(result.current.registerTerms?.couponPct).toBe(shown);
      expect(result.current.scheduledCouponPct).toBe(String(shown));
      expect(result.current.isValid).toBe(true);

      await result.current.saveEdit(contextOf(holding));

      expect(mockWrittenMetadata.at(-1)).toEqual(isinMetadata);
    },
  );

  it('leaves the coupon to the user when their own coupon replaced the schedule, or none exists', async () => {
    const ownCoupon = await seededOn(afterStep, { ...stepUpMetadata, payments: [] });

    expect(ownCoupon.result.current.scheduledCouponPct).toBeNull();

    const withoutSchedule = await seededOn(afterStep, {
      ...stepUpMetadata,
      isin: undefined,
      payments: undefined,
    });

    expect(withoutSchedule.result.current.scheduledCouponPct).toBeNull();
  });

  // Another face value is another bond: the save drops the schedule by that
  // rule, so the coupon it books is the typed one again.
  it('leaves the coupon to the user once the face value changed', async () => {
    const { result } = await seededOn(afterStep, stepUpMetadata);

    await act(async () => {
      result.current.setFaceValue('2');
    });

    expect(result.current.scheduledCouponPct).toBeNull();
  });
});

describe('useBondFields entry mode', () => {
  const storedBond = (metadata: Record<string, unknown>) =>
    ({
      currency: 'UAH',
      metadata: {
        quantity: 10,
        faceValueMinorUnits: 100_000,
        couponPct: 9.5,
        purchaseDate: new Date(2026, 8, 1).getTime(),
        purchasePriceMinorUnits: 1_000_000,
        maturityDate: new Date(2029, 5, 24).getTime(),
        couponFrequency: 'quarterly',
        ...metadata,
      },
    }) as unknown as HoldingRow;
  const payments = [{ date: new Date(2029, 5, 24).getTime(), kind: 'redemption', amount: '1000' }];

  const seededMode = async (metadata: Record<string, unknown>) => {
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(storedBond(metadata));
    });

    return result.current.bondMode;
  };

  it('stores ISIN for a bond created in ISIN mode', async () => {
    mockBondRegisterRows = [foundRow()];
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.createPayload().metadata).toMatchObject({ entryMode: 'isin' });
  });

  it('stores Manual for a bond created in Manual mode, with or without an ISIN', async () => {
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setBondMode('manual');
    });

    expect(result.current.createPayload().metadata).toMatchObject({ entryMode: 'manual' });

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.createPayload().metadata).toMatchObject({ entryMode: 'manual' });
  });

  it('stores Manual once an unmapped frequency switched the form to Manual', async () => {
    mockBondRegisterRows = [foundRow({ couponFrequency: null })];
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.createPayload().metadata).toMatchObject({ entryMode: 'manual' });
  });

  it('opens an edit in the mode the bond was saved from', async () => {
    expect(await seededMode({ isin: VALID_ISIN, entryMode: 'isin' })).toBe('isin');
    expect(await seededMode({ isin: VALID_ISIN, entryMode: 'manual', payments })).toBe('manual');
  });

  it('opens a bond saved before the mode was stored in Manual, even with an ISIN and a kept schedule', async () => {
    expect(await seededMode({ isin: VALID_ISIN, payments })).toBe('manual');
    expect(await seededMode({ isin: VALID_ISIN })).toBe('manual');
    expect(await seededMode({})).toBe('manual');
  });

  it('saves an unchanged ISIN-mode edit as ISIN', async () => {
    mockBondRegisterRows = [foundRow()];
    const holding = storedBond({ isin: VALID_ISIN, entryMode: 'isin' });
    mockStoredMetadata = holding.metadata;
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(holding);
    });
    await result.current.saveEdit({
      holdingId: 'h1',
      name: 'Bond',
      color: null,
      currency: 'UAH',
      isSynced: false,
      editingHolding: holding,
      book: EMPTY_PRICE_BOOK,
    });

    expect(mockWrittenMetadata.at(-1)).toMatchObject({ entryMode: 'isin', couponPct: 9.5 });
  });
});

// A matured or delisted ISIN leaves the register, and an offline phone may
// have no cache at all: the bond's own stored terms still describe it.
describe('useBondFields ISIN-mode edit of an ISIN the register does not list', () => {
  const storedMetadata = {
    quantity: 10,
    faceValueMinorUnits: 100_000,
    couponPct: 9,
    purchasePriceMinorUnits: 950_000,
    purchaseDate: new Date(2026, 0, 1).getTime(),
    maturityDate: new Date(2028, 0, 1).getTime(),
    bondKind: 'government',
    couponFrequency: 'semiannually',
    isin: VALID_ISIN,
    entryMode: 'isin',
    payments: [
      { date: new Date(2026, 6, 1).getTime(), kind: 'coupon', amount: '45' },
      { date: new Date(2027, 0, 1).getTime(), kind: 'coupon', amount: '60' },
      { date: new Date(2028, 0, 1).getTime(), kind: 'redemption', amount: '1000' },
    ],
  };
  const holding = { currency: 'UAH', metadata: storedMetadata } as unknown as HoldingRow;
  const context: EditContext = {
    holdingId: 'h1',
    name: 'Bond',
    color: null,
    currency: 'UAH',
    isSynced: false,
    editingHolding: holding,
    book: EMPTY_PRICE_BOOK,
  };

  it.each([
    ['the register no longer lists it', 1],
    ['the cache is empty (offline)', null],
  ])('saves the stored terms unchanged when %s', async (_case, fetchedAt) => {
    mockFetchedAtRows = [{ value: fetchedAt }];
    mockStoredMetadata = storedMetadata;
    const setName = jest.fn();
    const { result } = await renderBondFields(true, setName);

    await act(async () => {
      result.current.seed(holding);
    });

    expect(result.current.bondMode).toBe('isin');
    expect(result.current.registerTerms).toBeNull();
    expect(result.current.isValid).toBe(true);

    await result.current.saveEdit(context);

    expect(setName).not.toHaveBeenCalled();
    expect(mockWrittenMetadata.at(-1)).toEqual(storedMetadata);
  });

  it('shows the yield from the stored schedule, the same as the holding detail', async () => {
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(holding);
    });

    const detailYield = bondYieldToMaturity(storedMetadata, 'UAH', null);

    expect(detailYield).not.toBeNull();
    expect(result.current.yieldToMaturity).toBe(detailYield);
  });

  it('keeps the price of an edit typed with a dangling separator', async () => {
    mockStoredMetadata = storedMetadata;
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(holding);
    });
    await act(async () => {
      result.current.setPurchasePrice('1 100,');
    });

    expect(result.current.isValid).toBe(true);

    await result.current.saveEdit(context);

    expect(mockWrittenMetadata.at(-1)).toMatchObject({ purchasePriceMinorUnits: 1_100_000 });
  });

  // User ruling: nothing stored is overwritten. Terms typed over the stored
  // ones describe another bond, one the register does not list either.
  it('blocks the stored ISIN in ISIN mode once Manual typed over its terms', async () => {
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(holding);
    });
    await act(async () => {
      result.current.setBondMode('manual');
    });
    await act(async () => {
      result.current.setFaceValue('2 000');
      result.current.setCouponPct('12');
      result.current.setMaturityDate(new Date(2030, 0, 1).getTime());
    });
    await act(async () => {
      result.current.setBondMode('isin');
    });

    expect(result.current.isinReasonKey).toBe('forms.holding.isinNotInRegister');
    expect(result.current.isValid).toBe(false);
  });

  // The kind is a Manual-only chip: an ISIN-mode save would store a kind the
  // reopened bond no longer shows.
  it('blocks the stored ISIN in ISIN mode once Manual changed its bond kind', async () => {
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(holding);
    });
    await act(async () => {
      result.current.setBondMode('manual');
    });
    await act(async () => {
      result.current.setBondKind('corporate');
    });
    await act(async () => {
      result.current.setBondMode('isin');
    });

    expect(result.current.isinReasonKey).toBe('forms.holding.isinNotInRegister');
    expect(result.current.isValid).toBe(false);
  });

  it.each([
    ['bond kind', (fields: UseBondFieldsResult) => fields.setBondKind('corporate')],
    ['face value', (fields: UseBondFieldsResult) => fields.setFaceValue('2 000')],
    ['coupon', (fields: UseBondFieldsResult) => fields.setCouponPct('12')],
    ['coupon frequency', (fields: UseBondFieldsResult) => fields.setCouponFrequency('annually')],
    [
      'maturity date',
      (fields: UseBondFieldsResult) => fields.setMaturityDate(new Date(2030, 0, 1).getTime()),
    ],
  ])('blocks the stored ISIN in ISIN mode once its %s changed', async (_field, change) => {
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(holding);
    });
    await act(async () => {
      change(result.current);
    });

    expect(result.current.isinReasonKey).toBe('forms.holding.isinNotInRegister');
    expect(result.current.isValid).toBe(false);
  });

  it('still blocks a create with an ISIN the register does not list', async () => {
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
      result.current.setQuantity('10');
      result.current.setPurchasePrice('950');
    });

    expect(result.current.isinReasonKey).toBe('forms.holding.isinNotInRegister');
    expect(result.current.isValid).toBe(false);
  });
});

// A bond is a whole unit. A pasted or restored fractional quantity seeds no
// price per bond, so Save must wait for a whole one rather than drop the
// stored price.
describe('useBondFields whole-number quantity', () => {
  const storedBond = (quantity: number) =>
    ({
      currency: 'UAH',
      metadata: {
        quantity,
        faceValueMinorUnits: 100_000,
        couponPct: 9,
        purchasePriceMinorUnits: 1_000_000,
        purchaseDate: new Date(2026, 0, 1).getTime(),
        maturityDate: new Date(2028, 0, 1).getTime(),
        bondKind: 'government',
        couponFrequency: 'semiannually',
        entryMode: 'manual',
      },
    }) as unknown as HoldingRow;

  it('blocks Save for a quantity of 2.5, and keeps the stored total once it is 3 again', async () => {
    const holding = storedBond(3);
    mockStoredMetadata = holding.metadata;
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(holding);
    });
    await act(async () => {
      result.current.setQuantity('2.5');
    });

    expect(result.current.fieldErrors.quantityError).toBe('forms.holding.quantityWholeError');
    expect(result.current.isValid).toBe(false);

    await act(async () => {
      result.current.setQuantity('3');
    });

    expect(result.current.isValid).toBe(true);

    await result.current.saveEdit({
      holdingId: 'h1',
      name: 'Bond',
      color: null,
      currency: 'UAH',
      isSynced: false,
      editingHolding: holding,
      book: EMPTY_PRICE_BOOK,
    });

    expect(mockWrittenMetadata.at(-1)).toMatchObject({
      quantity: 3,
      purchasePriceMinorUnits: 1_000_000,
    });
  });

  it('shows the quantity error on an edit of a restored non-whole quantity', async () => {
    const { result } = await renderBondFields(true);

    await act(async () => {
      result.current.seed(storedBond(2.5));
    });

    expect(result.current.fieldErrors.quantityError).toBe('forms.holding.quantityWholeError');
    expect(result.current.isValid).toBe(false);
  });
});

describe('useBondFields yield to maturity', () => {
  // The face, coupon and maturity the first match filled stay in the form, but
  // they are not the terms of the ISIN now typed.
  it('shows no yield once a matched ISIN is changed to one the register does not list', async () => {
    mockBondRegisterRows = [foundRow()];
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });
    await act(async () => {
      result.current.setQuantity('10');
      result.current.setPurchasePrice('950');
    });

    expect(result.current.yieldToMaturity).not.toBeNull();

    await act(async () => {
      result.current.setIsin('XS2895055981');
    });

    expect(result.current.registerTerms).toBeNull();
    expect(result.current.yieldToMaturity).toBeNull();
  });
});

describe('useBondFields scrollTargets', () => {
  it('orders scrollTargets isin, coupon-frequency pick, quantity, purchasePrice, faceValue, couponPct, purchaseDate, maturity', async () => {
    const { result } = await renderBondFields();
    const { refs } = result.current;

    expect(result.current.scrollTargets.map((target) => target.ref)).toEqual([
      refs.isinFieldRef,
      refs.isinFieldRef,
      refs.quantityFieldRef,
      refs.purchasePriceFieldRef,
      refs.faceValueFieldRef,
      refs.couponPctFieldRef,
      refs.purchaseDateFieldRef,
      refs.purchaseDateFieldRef,
    ]);
  });

  it('blocks on the ISIN field first by default, in ISIN mode with a blank ISIN', async () => {
    const { result } = await renderBondFields();

    const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

    expect(firstInvalid?.ref).toBe(result.current.refs.isinFieldRef);
  });

  it('targets the ISIN ref for the coupon-frequency-pick reason, once back in ISIN mode for an unmapped-frequency match', async () => {
    mockBondRegisterRows = [foundRow({ couponFrequency: null })];
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });
    // The unmapped frequency auto-switched to Manual; tap back to ISIN.
    await act(async () => {
      result.current.setBondMode('isin');
    });

    expect(result.current.needsCouponFrequencyPick).toBe(true);
    expect(result.current.isinReasonKey).toBeNull();

    const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

    expect(firstInvalid).toBe(result.current.scrollTargets[1]);
    expect(firstInvalid?.ref).toBe(result.current.refs.isinFieldRef);
  });

  it('redirects an ISIN-mode maturity-order reason to the purchase-date field, not the (unmounted) maturity field', async () => {
    // A mapped frequency keeps bondMode on 'isin'; a maturity BEFORE today's
    // auto-defaulted purchase date trips the out-of-order reason.
    mockBondRegisterRows = [foundRow({ maturityDate: new Date(2020, 0, 1).getTime() })];
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });
    await act(async () => {
      result.current.setQuantity('5');
      result.current.setPurchasePrice('5 000');
    });

    expect(result.current.bondMode).toBe('isin');
    expect(result.current.fieldErrors.maturityDateError).toBe('forms.holding.maturityDateError');

    const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

    expect(firstInvalid).toBe(result.current.scrollTargets.at(-1));
    expect(firstInvalid?.ref).toBe(result.current.refs.purchaseDateFieldRef);
  });

  it('requires the purchase price in ISIN mode and blocks Save until it is typed', async () => {
    mockBondRegisterRows = [foundRow()];
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });
    await act(async () => {
      result.current.setQuantity('5');
    });

    expect(result.current.fieldErrors.purchasePriceError).toBe(
      'forms.holding.purchasePriceRequiredError',
    );
    expect(result.current.isValid).toBe(false);
    expect(result.current.scrollTargets.find((target) => target.invalid)?.ref).toBe(
      result.current.refs.purchasePriceFieldRef,
    );

    await act(async () => {
      result.current.setPurchasePrice('5 000');
    });

    expect(result.current.fieldErrors.purchasePriceError).toBeNull();
    expect(result.current.isValid).toBe(true);
  });

  it('keeps the purchase price optional in Manual mode', async () => {
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setBondMode('manual');
    });

    expect(result.current.fieldErrors.purchasePriceError).toBeNull();
  });

  it('points the same maturity-order reason at the maturity field once switched to Manual mode', async () => {
    mockBondRegisterRows = [foundRow({ maturityDate: new Date(2020, 0, 1).getTime() })];
    const { result } = await renderBondFields();

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });
    await act(async () => {
      result.current.setBondMode('manual');
    });

    const lastTarget = result.current.scrollTargets.at(-1);

    expect(lastTarget?.invalid).toBe(true);
    expect(lastTarget?.ref).toBe(result.current.refs.maturityDateFieldRef);
  });
});
