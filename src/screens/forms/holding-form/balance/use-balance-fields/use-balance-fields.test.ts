const mockUpdateWithBalanceDelta = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    updateWithBalanceDelta: (...args: unknown[]) => mockUpdateWithBalanceDelta(...args),
    balanceOf: (row: { currency: string; balanceMinorUnits: number }) => ({
      currency: row.currency,
      minorUnits: row.balanceMinorUnits,
    }),
  },
}));

import { Money } from '@kiko/currency/money';
import { EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { act, renderHook } from '@testing-library/react-native';

import type { EditContext } from '../../holding-type-form';

import { useBalanceFields } from './use-balance-fields';

const renderBalanceFields = () => renderHook(() => useBalanceFields({ currency: 'UAH' }));

const baseContext = (overrides: Partial<EditContext> = {}): EditContext => ({
  holdingId: 'h-1',
  name: 'Everyday card',
  color: '#FF0000',
  currency: 'UAH',
  isSynced: false,
  editingHolding: undefined,
  book: EMPTY_PRICE_BOOK,
  ...overrides,
});

describe('useBalanceFields', () => {
  beforeEach(() => {
    mockUpdateWithBalanceDelta.mockClear();
  });

  it('defaults to a blank opening balance, always valid, with no scroll targets', async () => {
    const { result } = await renderBalanceFields();

    expect(result.current.openingBalance).toBe('');
    expect(result.current.isValid).toBe(true);
    expect(result.current.scrollTargets).toEqual([]);
  });

  it('converts the live opening balance text to minor units in the given currency', async () => {
    const { result } = await renderBalanceFields();

    await act(async () => {
      result.current.setOpeningBalance('250');
    });

    expect(result.current.createPayload().openingBalance).toEqual(Money.of('UAH', 250_00));
  });

  it('seeds the opening balance as a grouped major string from a stored holding', async () => {
    const { result } = await renderBalanceFields();

    await act(async () => {
      result.current.seed({
        id: 'h-1',
        currency: 'UAH',
        balanceMinorUnits: 25_000_00,
        // `seed` only reads the fields above; a full HoldingRow literal would be pure noise here,
        // mirroring the sibling seed-function tests.
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture)
      } as any);
    });

    expect(result.current.openingBalance).toBe('25 000');
  });

  it('writes the live opening-balance field through createPayload', async () => {
    const { result } = await renderBalanceFields();

    await act(async () => {
      result.current.setOpeningBalance('500');
    });

    expect(result.current.createPayload()).toEqual({
      openingBalance: Money.of('UAH', 500_00),
      metadata: undefined,
    });
  });

  it('writes name, color and the live balance through updateWithBalanceDelta when not synced', async () => {
    const { result } = await renderBalanceFields();

    await act(async () => {
      result.current.setOpeningBalance('500');
    });
    await result.current.saveEdit(baseContext({ isSynced: false }));

    expect(mockUpdateWithBalanceDelta).toHaveBeenCalledWith(
      'h-1',
      { name: 'Everyday card', color: '#FF0000', balance: Money.of('UAH', 500_00) },
      expect.any(Number),
    );
  });

  it('omits the balance entirely when the holding is synced', async () => {
    const { result } = await renderBalanceFields();

    await result.current.saveEdit(baseContext({ isSynced: true }));

    expect(mockUpdateWithBalanceDelta).toHaveBeenCalledWith(
      'h-1',
      { name: 'Everyday card', color: '#FF0000' },
      expect.any(Number),
    );
  });
});
