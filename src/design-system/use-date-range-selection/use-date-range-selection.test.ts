import { defaultDateRange } from '@kiko/dates';
import { act, renderHook } from '@testing-library/react-native';

import { useDateRangeSelection } from './use-date-range-selection';

const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();

describe('useDateRangeSelection', () => {
  it('starts on the default last-30-days range', async () => {
    const { result } = await renderHook(() => useDateRangeSelection(NOW));

    const range = defaultDateRange(NOW);

    expect(result.current.dateFrom).toEqual(range.from);
    expect(result.current.dateTo).toEqual(range.to);
  });

  it('holds a picked range exactly as given', async () => {
    const { result } = await renderHook(() => useDateRangeSelection(NOW));
    const from = new Date(2026, 0, 2);
    const to = new Date(2026, 0, 9);

    await act(async () => {
      result.current.applyDateRange(from, to);
    });

    expect(result.current.dateFrom).toBe(from);
    expect(result.current.dateTo).toBe(to);
  });

  it('keeps an open-ended side null instead of falling back to the default', async () => {
    const { result } = await renderHook(() => useDateRangeSelection(NOW));
    const from = new Date(2026, 0, 2);

    await act(async () => {
      result.current.applyDateRange(from, null);
    });

    expect(result.current.dateFrom).toBe(from);
    expect(result.current.dateTo).toBeNull();

    await act(async () => {
      result.current.applyDateRange(null, null);
    });

    expect(result.current.dateFrom).toBeNull();
    expect(result.current.dateTo).toBeNull();
  });

  it('returns to the default range when cleared', async () => {
    const { result } = await renderHook(() => useDateRangeSelection(NOW));

    await act(async () => {
      result.current.applyDateRange(new Date(2026, 0, 2), new Date(2026, 0, 9));
    });
    await act(async () => {
      result.current.clearDateRange();
    });

    const range = defaultDateRange(NOW);

    expect(result.current.dateFrom).toEqual(range.from);
    expect(result.current.dateTo).toEqual(range.to);
  });

  it('derives the default range fresh from a later now, but keeps a pick as given', async () => {
    const later = new Date(2026, 5, 20, 12, 0, 0).getTime();
    const { result, rerender } = await renderHook(
      ({ now }: { now: number }) => useDateRangeSelection(now),
      { initialProps: { now: NOW } },
    );

    await rerender({ now: later });

    const range = defaultDateRange(later);

    expect(result.current.dateFrom).toEqual(range.from);
    expect(result.current.dateTo).toEqual(range.to);

    const from = new Date(2026, 0, 2);
    const to = new Date(2026, 0, 9);

    await act(async () => {
      result.current.applyDateRange(from, to);
    });
    await rerender({ now: NOW });

    expect(result.current.dateFrom).toBe(from);
    expect(result.current.dateTo).toBe(to);
  });
});
