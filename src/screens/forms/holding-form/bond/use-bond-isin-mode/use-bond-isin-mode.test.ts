import { act, renderHook } from '@testing-library/react-native';

let mockBondRegisterRows: { isin: string; terms: unknown; fetchedAt: number }[] = [];
// Non-null by default (a cache exists) — most tests care about a FOUND vs.
// NOT-FOUND match, not the "never loaded" distinction; the dedicated
// never-loaded tests override this to `null`.
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

import { refreshBondRegisterIfStale } from '@kiko/bonds/bond-register-repo';

import { useBondIsinMode, type UseBondIsinModeParams } from './use-bond-isin-mode';

const refreshMock = refreshBondRegisterIfStale as jest.Mock;

// A real register ISIN, checksum-valid.
const VALID_ISIN = 'UA4000234215';
// Valid-shaped, wrong check digit.
const INVALID_CHECKDIGIT_ISIN = 'UA4000227046';

const foundRow = (overrides: { currency?: string; couponFrequency?: string | null } = {}) => ({
  isin: VALID_ISIN,
  terms: {
    isin: VALID_ISIN,
    currency: overrides.currency ?? 'USD',
    faceValueMinorUnits: 100_000,
    couponPct: 9.5,
    maturityDate: new Date(2029, 5, 24).getTime(),
    couponFrequency: 'couponFrequency' in overrides ? overrides.couponFrequency : 'quarterly',
    name: 'Register Bond',
  },
  fetchedAt: 1,
});

const baseParams = () => ({
  type: 'bond' as const,
  isEdit: false,
  currency: 'UAH' as const,
  purchaseDate: null,
  setPurchaseDate: jest.fn(),
  setFaceValue: jest.fn(),
  setCouponPct: jest.fn(),
  setMaturityDate: jest.fn(),
  setBondKind: jest.fn(),
  setCouponFrequency: jest.fn(),
  setCurrency: jest.fn(),
  setName: jest.fn(),
});

const renderTheHook = (params: UseBondIsinModeParams) =>
  renderHook((props: UseBondIsinModeParams) => useBondIsinMode(props), { initialProps: params });

beforeEach(() => {
  mockBondRegisterRows = [];
  mockFetchedAtRows = [{ value: 1 }];
  refreshMock.mockClear();
});

describe('useBondIsinMode', () => {
  it('defaults to ISIN mode with an empty ISIN', async () => {
    const { result } = await renderHook(() => useBondIsinMode(baseParams()));

    expect(result.current.bondMode).toBe('isin');
    expect(result.current.isin).toBe('');
    expect(result.current.registerTerms).toBeNull();
  });

  it('triggers refreshBondRegisterIfStale once for a bond', async () => {
    await renderHook(() => useBondIsinMode(baseParams()));

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not trigger the refresh for a non-bond type', async () => {
    await renderHook(() => useBondIsinMode({ ...baseParams(), type: 'term_deposit' }));

    expect(refreshMock).not.toHaveBeenCalled();
  });

  // A macrotask flush (not a spy on jest's sandboxed `process`, which
  // can never observe a real unhandledRejection) lets jest-circus's own
  // real-process handler catch a reverted bare fire-and-forget call.
  it('never produces an unhandled rejection when the refresh rejects (a caught fire-and-forget)', async () => {
    refreshMock.mockRejectedValueOnce(new Error('network down'));

    await renderHook(() => useBondIsinMode(baseParams()));
    // A macrotask boundary, not a microtask flush: `either()`'s own
    // `.catch()` resolves on a microtask, but jest-circus only surfaces an
    // unhandled rejection it observed BEFORE the test's own promise chain
    // is considered settled, which needs a real event-loop turn.
    await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
  });

  // The found-terms apply must fire ONCE per
  // matched ISIN, never on an unrelated change (a picked date) that shares
  // the effect's dependency array.
  it('applies the found terms exactly once per matched ISIN, never again on an unrelated purchaseDate change', async () => {
    mockBondRegisterRows = [foundRow()];
    const params = baseParams();
    const { result, rerender } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(params.setName).toHaveBeenCalledTimes(1);
    expect(params.setName).toHaveBeenCalledWith('Register Bond');
    expect(params.setCurrency).toHaveBeenCalledTimes(1);

    // An unrelated prop change (e.g. the user picked a purchase date) still
    // reports the SAME matched isin — the apply must not fire again.
    await act(async () => {
      await rerender({ ...params, purchaseDate: Date.now() });
    });

    expect(params.setName).toHaveBeenCalledTimes(1);
    expect(params.setCurrency).toHaveBeenCalledTimes(1);
  });

  // A match that resolves while the user is in
  // MANUAL mode must still apply the first time they switch to ISIN — the
  // lookup itself never depended on `bondMode`, only the APPLY did.
  it('applies a match resolved in Manual mode once the user switches to ISIN', async () => {
    mockBondRegisterRows = [foundRow()];
    const params = baseParams();
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setBondMode('manual');
      result.current.setIsin(VALID_ISIN);
    });

    // Still in Manual — nothing applied yet.
    expect(params.setName).not.toHaveBeenCalled();
    expect(result.current.registerTerms).not.toBeNull();

    await act(async () => {
      result.current.setBondMode('isin');
    });

    expect(params.setName).toHaveBeenCalledWith('Register Bond');
    expect(params.setFaceValue).toHaveBeenCalledTimes(1);
  });

  // A named variant: not-in-register -> Switch to manual -> the
  // refresh lands (the isin becomes a match while still in Manual) -> the
  // user taps ISIN again. The match must apply then, not stay dead.
  it('applies a match that only resolves AFTER switching to Manual, once ISIN is tapped again', async () => {
    mockBondRegisterRows = [];
    const params = baseParams();
    const { result, rerender } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });
    expect(result.current.isinReasonKey).toBe('forms.holding.isinNotInRegister');

    await act(async () => {
      result.current.setBondMode('manual');
    });

    // The refresh lands: the register now has this ISIN, while the user is
    // still in Manual mode. `rerender` (a genuine prop change) forces the
    // hook to re-read the mocked `useLiveQuery` result.
    mockBondRegisterRows = [foundRow()];
    await act(async () => {
      await rerender({ ...params, purchaseDate: Date.now() });
    });

    await act(async () => {
      result.current.setBondMode('isin');
    });

    expect(params.setName).toHaveBeenCalledWith('Register Bond');
  });

  // An unmapped `pay_period` (couponFrequency: null) auto-switches to
  // Manual once — but re-tapping "ISIN" afterward must not loop straight
  // back to Manual, since the effect is keyed on the isin string, not mode.
  // Also assert the OTHER found fields (face
  // value, coupon, maturity, name) still applied, not just the frequency
  // that was skipped.
  it('auto-switches to Manual once for an unmapped coupon frequency, pre-fills every OTHER field, and stays in ISIN mode on a re-tap', async () => {
    mockBondRegisterRows = [foundRow({ couponFrequency: null })];
    const params = baseParams();
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.bondMode).toBe('manual');
    expect(params.setCouponFrequency).not.toHaveBeenCalled();
    expect(params.setFaceValue).toHaveBeenCalledTimes(1);
    expect(params.setCouponPct).toHaveBeenCalledWith('9.5');
    expect(params.setMaturityDate).toHaveBeenCalledWith(new Date(2029, 5, 24).getTime());
    expect(params.setBondKind).toHaveBeenCalledWith('government');
    expect(params.setName).toHaveBeenCalledWith('Register Bond');

    await act(async () => {
      result.current.setBondMode('isin');
    });

    // Tapping "ISIN" again must stick — the apply effect does not re-fire
    // for the SAME isin, so nothing switches it back to Manual.
    expect(result.current.bondMode).toBe('isin');
  });

  // Re-entering ISIN mode for
  // an unmapped-frequency match must ask the user to pick a frequency —
  // never silently keep whatever `couponFrequency` already happened to be
  // in state (the untouched initial default).
  it('needs a coupon-frequency pick once back in ISIN mode for an unmapped-frequency match, and clears once picked', async () => {
    mockBondRegisterRows = [foundRow({ couponFrequency: null })];
    const params = baseParams();
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });
    // Auto-switched to Manual — no pick needed while there.
    expect(result.current.needsCouponFrequencyPick).toBe(false);

    await act(async () => {
      result.current.setBondMode('isin');
    });

    expect(result.current.needsCouponFrequencyPick).toBe(true);
    expect(result.current.pickedCouponFrequency).toBeNull();

    await act(async () => {
      result.current.setPickedCouponFrequency('quarterly');
    });

    expect(result.current.pickedCouponFrequency).toBe('quarterly');
    // The pick also updates the shared `couponFrequency` state so Manual
    // mode and `buildBondMetadata` see the same value.
    expect(params.setCouponFrequency).toHaveBeenCalledWith('quarterly');
  });

  it('never needs a coupon-frequency pick for a match with a mapped frequency', async () => {
    mockBondRegisterRows = [foundRow({ couponFrequency: 'quarterly' })];
    const params = baseParams();
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.needsCouponFrequencyPick).toBe(false);
  });

  // In edit mode, a found ISIN whose currency differs from the
  // (locked) holding currency must not apply at all, and must block save
  // with its own reason.
  it('does not apply a found ISIN whose currency differs from the holding currency in edit mode, and blocks save', async () => {
    mockBondRegisterRows = [foundRow({ currency: 'USD' })];
    const params = { ...baseParams(), isEdit: true, currency: 'UAH' as const };
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(params.setName).not.toHaveBeenCalled();
    expect(params.setCurrency).not.toHaveBeenCalled();
    expect(result.current.isinReasonKey).toBe('forms.holding.isinCurrencyMismatchError');
  });

  it('applies a found ISIN in edit mode when the currency already matches, without writing currency', async () => {
    mockBondRegisterRows = [foundRow({ currency: 'UAH' })];
    const params = { ...baseParams(), isEdit: true, currency: 'UAH' as const };
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(params.setName).toHaveBeenCalledTimes(1);
    expect(params.setCurrency).not.toHaveBeenCalled();
    expect(result.current.isinReasonKey).toBeNull();
  });

  it('blocks with a check-digit reason for a valid-shaped ISIN with the wrong check digit', async () => {
    const params = baseParams();
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(INVALID_CHECKDIGIT_ISIN);
    });

    expect(result.current.isinReasonKey).toBe('forms.holding.isinCheckDigitError');
  });

  // A stale row from the PREVIOUS query (useLiveQuery keeps old `data`
  // until the new query settles) must never be read as a match for a
  // DIFFERENT, currently-typed isin.
  it('ignores a register row whose own isin does not match the currently typed ISIN (a stale query result)', async () => {
    mockBondRegisterRows = [{ isin: 'XS2895055981', terms: foundRow().terms, fetchedAt: 1 }];
    const params = baseParams();
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.registerTerms).toBeNull();
  });

  // "No cache yet" (never fetched) reads a
  // different, neutral reason than a confident "not in the register".
  it('reports a neutral "register not loaded" reason when the cache has never been populated', async () => {
    mockBondRegisterRows = [];
    mockFetchedAtRows = [{ value: null }];
    const params = baseParams();
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.registerLoaded).toBe(false);
    expect(result.current.isinReasonKey).toBe('forms.holding.isinRegisterNotLoaded');
  });

  it('reports a confident "not in the register" reason once the cache has SOME data', async () => {
    mockBondRegisterRows = [];
    mockFetchedAtRows = [{ value: 1_700_000_000_000 }];
    const params = baseParams();
    const { result } = await renderTheHook(params);

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.registerLoaded).toBe(true);
    expect(result.current.isinReasonKey).toBe('forms.holding.isinNotInRegister');
  });
});
