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

import { useBondFields } from './use-bond-fields';

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

const renderBondFields = () =>
  renderHook(() =>
    useBondFields({
      type: 'bond',
      isEdit: false,
      currency: 'UAH',
      setCurrency: jest.fn(),
      setName: jest.fn(),
    }),
  );

beforeEach(() => {
  mockBondRegisterRows = [];
  mockFetchedAtRows = [{ value: 1 }];
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
