import { act, renderHook } from '@testing-library/react-native';

let mockBondRegisterRows: { isin: string; terms: unknown; fetchedAt: number }[] = [];

jest.mock('../../../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockBondRegisterRows }),
}));

jest.mock('../../../../bonds/bond-register-repo', () => ({
  bondRegisterRepo: { findByIsinQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
  refreshBondRegisterIfStale: jest.fn().mockResolvedValue(undefined),
}));

import { refreshBondRegisterIfStale } from '../../../../bonds/bond-register-repo';

import { useBondIsinMode, type UseBondIsinModeParams } from './use-bond-isin-mode';

const refreshMock = refreshBondRegisterIfStale as jest.Mock;

// UA4000234215 (T23/T24 fixture): a real register ISIN, checksum-valid.
const VALID_ISIN = 'UA4000234215';
// UA4000227046 (T23 fixture): valid-shaped, wrong check digit.
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

beforeEach(() => {
  mockBondRegisterRows = [];
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

  // M5 (T25 review round 1): a rejected refresh (e.g. offline) must stay
  // quiet — no thrown error, no unhandled rejection, no form-visible state.
  it('stays quiet when refreshBondRegisterIfStale rejects (offline)', async () => {
    refreshMock.mockRejectedValueOnce(new Error('network down'));

    await expect(renderHook(() => useBondIsinMode(baseParams()))).resolves.toBeDefined();
  });

  // I1 (T25 review round 1): the found-terms apply must fire ONCE per
  // matched ISIN, never on an unrelated change (a picked date) that shares
  // the effect's dependency array.
  it('applies the found terms exactly once per matched ISIN, never again on an unrelated purchaseDate change', async () => {
    mockBondRegisterRows = [foundRow()];
    const params = baseParams();
    const { result, rerender } = await renderHook(
      (props: UseBondIsinModeParams) => useBondIsinMode(props),
      {
        initialProps: params,
      },
    );

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(params.setName).toHaveBeenCalledTimes(1);
    expect(params.setName).toHaveBeenCalledWith('Register Bond');
    expect(params.setCurrency).toHaveBeenCalledTimes(1);

    // An unrelated prop change (e.g. the user picked a purchase date) still
    // reports the SAME matched isin — the apply must not fire again.
    await act(async () => {
      rerender({ ...params, purchaseDate: Date.now() });
    });

    expect(params.setName).toHaveBeenCalledTimes(1);
    expect(params.setCurrency).toHaveBeenCalledTimes(1);
  });

  // I3: an unmapped `pay_period` (couponFrequency: null) auto-switches to
  // Manual once — but re-tapping "ISIN" afterward must not loop straight
  // back to Manual, since the effect is keyed on the isin string, not mode.
  it('auto-switches to Manual once for an unmapped coupon frequency, and stays in ISIN mode on a re-tap', async () => {
    mockBondRegisterRows = [foundRow({ couponFrequency: null })];
    const params = baseParams();
    const { result } = await renderHook((props: UseBondIsinModeParams) => useBondIsinMode(props), {
      initialProps: params,
    });

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.bondMode).toBe('manual');
    expect(params.setCouponFrequency).not.toHaveBeenCalled();

    await act(async () => {
      result.current.setBondMode('isin');
    });

    // Tapping "ISIN" again must stick — the apply effect does not re-fire
    // for the SAME isin, so nothing switches it back to Manual.
    expect(result.current.bondMode).toBe('isin');
  });

  // I5: in edit mode, a found ISIN whose currency differs from the
  // (locked) holding currency must not apply at all, and must block save
  // with its own reason.
  it('does not apply a found ISIN whose currency differs from the holding currency in edit mode, and blocks save', async () => {
    mockBondRegisterRows = [foundRow({ currency: 'USD' })];
    const params = { ...baseParams(), isEdit: true, currency: 'UAH' as const };
    const { result } = await renderHook((props: UseBondIsinModeParams) => useBondIsinMode(props), {
      initialProps: params,
    });

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
    const { result } = await renderHook((props: UseBondIsinModeParams) => useBondIsinMode(props), {
      initialProps: params,
    });

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(params.setName).toHaveBeenCalledTimes(1);
    expect(params.setCurrency).not.toHaveBeenCalled();
    expect(result.current.isinReasonKey).toBeNull();
  });

  it('blocks with a check-digit reason for a valid-shaped ISIN with the wrong check digit', async () => {
    const params = baseParams();
    const { result } = await renderHook((props: UseBondIsinModeParams) => useBondIsinMode(props), {
      initialProps: params,
    });

    await act(async () => {
      result.current.setIsin(INVALID_CHECKDIGIT_ISIN);
    });

    expect(result.current.isinReasonKey).toBe('forms.holding.isinCheckDigitError');
  });

  // M3: a stale row from the PREVIOUS query (useLiveQuery keeps old `data`
  // until the new query settles) must never be read as a match for a
  // DIFFERENT, currently-typed isin.
  it('ignores a register row whose own isin does not match the currently typed ISIN (a stale query result)', async () => {
    mockBondRegisterRows = [{ isin: 'XS2895055981', terms: foundRow().terms, fetchedAt: 1 }];
    const params = baseParams();
    const { result } = await renderHook((props: UseBondIsinModeParams) => useBondIsinMode(props), {
      initialProps: params,
    });

    await act(async () => {
      result.current.setIsin(VALID_ISIN);
    });

    expect(result.current.registerTerms).toBeNull();
  });
});
