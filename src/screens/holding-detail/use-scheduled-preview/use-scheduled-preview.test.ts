import { act, renderHook } from '@testing-library/react-native';
import { loanInstallments } from '@kiko/holdings/loan-schedule';

import { useScheduledPreview } from './use-scheduled-preview';

const installments = loanInstallments({
  kind: 'mortgage',
  principalMinorUnits: 1_200_000_00,
  startDate: new Date(2025, 0, 15).getTime(),
  schedule: 'annuity',
  annualRatePct: 12,
  termMonths: 360,
}).map((row) => ({ ...row, remainderMinorUnits: 0 }));

describe('useScheduledPreview', () => {
  it('shows the next 12 installments of a 360-installment mortgage and offers to expand', async () => {
    const { result } = await renderHook(() => useScheduledPreview(installments));

    expect(result.current.shown).toEqual(installments.slice(0, 12));
    expect(result.current.expanded).toBe(false);
    expect(result.current.canExpand).toBe(true);
  });

  it('shows every installment once toggled, and the first 12 again when toggled back', async () => {
    const { result } = await renderHook(() => useScheduledPreview(installments));

    await act(async () => {
      result.current.toggle();
    });

    expect(result.current.shown).toHaveLength(360);
    expect(result.current.expanded).toBe(true);

    await act(async () => {
      result.current.toggle();
    });

    expect(result.current.shown).toHaveLength(12);
    expect(result.current.expanded).toBe(false);
  });

  it.each([0, 1, 12])(
    'offers no expansion for %i installments, which already fit',
    async (count) => {
      const { result } = await renderHook(() => useScheduledPreview(installments.slice(0, count)));

      expect(result.current.shown).toHaveLength(count);
      expect(result.current.canExpand).toBe(false);
    },
  );

  it('offers to expand for 13 installments and reveals the 13th once toggled', async () => {
    const { result } = await renderHook(() => useScheduledPreview(installments.slice(0, 13)));

    expect(result.current.shown).toHaveLength(12);
    expect(result.current.canExpand).toBe(true);

    await act(async () => {
      result.current.toggle();
    });

    expect(result.current.shown).toHaveLength(13);
  });

  it('keeps the same shown list across a re-render with the same installments', async () => {
    const { result, rerender } = await renderHook(() => useScheduledPreview(installments));
    const before = result.current.shown;

    await rerender({});

    expect(result.current.shown).toBe(before);
  });
});
